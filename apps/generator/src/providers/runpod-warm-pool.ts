import type { Redis } from "@generator/queue";
import type {
	PodInputStore,
	PodSnapshot,
	RunpodPodsApi,
	WarmPodEntry,
	WarmPodPool,
} from "@generator/runpod";

const WARM_POOL_KEY_PREFIX = "runpod:warm-pod:";
const INPUT_STORE_KEY_PREFIX = "runpod:pod-input:";

// Pop the smallest-score (closest to expiring) entry, but only if it isn't
// already expired. Expired entries are purged inline so the next claim sees
// a clean set.
const CLAIM_LUA = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', '(' .. tostring(now))
local items = redis.call('ZRANGE', KEYS[1], 0, 0)
if #items == 0 then return false end
local m = items[1]
redis.call('ZREM', KEYS[1], m)
return m
`;

const FORGET_LUA = `
local target = ARGV[1]
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
local removed = 0
for _, m in ipairs(members) do
  local ok, parsed = pcall(cjson.decode, m)
  if ok and parsed and parsed.podId == target then
    removed = removed + redis.call('ZREM', KEYS[1], m)
  end
end
return removed
`;

const SCAN_PAGE_SIZE = 100;

function poolKey(workflowId: string): string {
	return `${WARM_POOL_KEY_PREFIX}${workflowId}`;
}

function inputKey(requestId: string): string {
	return `${INPUT_STORE_KEY_PREFIX}${requestId}`;
}

function parseEntry(raw: string): WarmPodEntry | null {
	try {
		const obj = JSON.parse(raw) as Partial<WarmPodEntry>;
		if (
			typeof obj.networkVolumeId !== "string" ||
			typeof obj.password !== "string" ||
			typeof obj.podId !== "string"
		) {
			return null;
		}
		return {
			networkVolumeId: obj.networkVolumeId,
			password: obj.password,
			podId: obj.podId,
		};
	} catch {
		return null;
	}
}

/**
 * Redis-backed warm pool. Layout:
 *
 * - `runpod:warm-pod:<workflowId>` → ZSET of JSON entries, score = expiresAt
 *   (ms since epoch). One sorted set per workflow keeps claim O(log N) and
 *   trivially supports lazy purge via `ZREMRANGEBYSCORE -inf <now>`.
 */
export function createRedisWarmPodPool(redis: Redis): WarmPodPool {
	return {
		async claim(workflowId) {
			const raw = (await redis.eval(
				CLAIM_LUA,
				1,
				poolKey(workflowId),
				Date.now().toString()
			)) as string | null;
			if (!raw) {
				return null;
			}
			return parseEntry(raw);
		},
		async forget(workflowId, podId) {
			await redis.eval(FORGET_LUA, 1, poolKey(workflowId), podId);
		},
		async list() {
			const now = Date.now();
			const out: Array<WarmPodEntry & { workflowId: string }> = [];
			let cursor = "0";
			do {
				const [next, keys] = await redis.scan(
					cursor,
					"MATCH",
					`${WARM_POOL_KEY_PREFIX}*`,
					"COUNT",
					SCAN_PAGE_SIZE
				);
				cursor = next;
				for (const key of keys) {
					const workflowId = key.slice(WARM_POOL_KEY_PREFIX.length);
					const members = await redis.zrangebyscore(key, now, "+inf");
					for (const member of members) {
						const entry = parseEntry(member);
						if (entry) {
							out.push({ ...entry, workflowId });
						}
					}
				}
			} while (cursor !== "0");
			return out;
		},
		async release(workflowId, entry, ttlMs) {
			const key = poolKey(workflowId);
			const expiresAt = Date.now() + ttlMs;
			const member = JSON.stringify({
				networkVolumeId: entry.networkVolumeId,
				password: entry.password,
				podId: entry.podId,
			});
			// Refresh the score for an existing entry (idempotent), then make sure
			// the bucket TTL outlives the latest entry so stale workflow keys
			// don't pile up after pool empties.
			await redis
				.multi()
				.zadd(key, expiresAt, member)
				.pexpire(key, ttlMs + 60_000)
				.exec();
		},
	};
}

interface ReaperOptions {
	api: RunpodPodsApi;
	intervalMs: number;
	logger?: Pick<Console, "info" | "warn">;
	/**
	 * Имена pod-ов, начинающихся с любого из этих префиксов, считаются "нашими".
	 * Любые другие RunPod-пакеты в аккаунте reaper не трогает.
	 */
	namePrefixes: readonly string[];
	now?: () => number;
	/**
	 * Не убивать pods младше этого порога — даже если их нет в warm-pool. Это
	 * защита от race'а "submit создал pod, ещё не передал в warmPool.release".
	 * Должен быть больше max execution duration, чтобы reaper не пристрелил
	 * pod в середине inference'а. Рекомендуется keepAliveMs + maxExecutionMs.
	 */
	safetyAgeMs: number;
	warmPool: WarmPodPool;
}

export interface PodReaper {
	/** Один проход reaper'а — для тестов и manual-trigger debugging'а. */
	run(): Promise<{ kept: number; reaped: string[] }>;
	/** Останавливает периодический цикл. */
	stop(): void;
}

const REAPER_NAME_PATTERN = /^(?<prefix>[a-z0-9-]+)-[a-z0-9]+$/u;

function podAgeMs(snapshot: PodSnapshot, now: number): number | null {
	const stamp = snapshot.lastStatusChange;
	if (!stamp) {
		return null;
	}
	const parsed = Date.parse(stamp);
	if (Number.isNaN(parsed)) {
		return null;
	}
	return now - parsed;
}

function podMatchesPrefix(
	snapshot: PodSnapshot,
	prefixes: readonly string[]
): boolean {
	const name = snapshot.name?.toLowerCase();
	if (!name) {
		return false;
	}
	for (const prefix of prefixes) {
		const needle = prefix.toLowerCase();
		if (name.startsWith(`${needle}-`)) {
			return true;
		}
	}
	const match = REAPER_NAME_PATTERN.exec(name);
	if (!match?.groups?.prefix) {
		return false;
	}
	return prefixes.includes(match.groups.prefix);
}

type ReaperVerdict =
	| { ageMs: number; kind: "reap" }
	| { kind: "keep" }
	| { kind: "skip" };

function classifyPod(
	pod: PodSnapshot,
	ctx: {
		namePrefixes: readonly string[];
		now: number;
		protectedIds: Set<string>;
		safetyAgeMs: number;
	}
): ReaperVerdict {
	if (pod.desiredStatus !== "RUNNING") {
		return { kind: "skip" };
	}
	if (!podMatchesPrefix(pod, ctx.namePrefixes)) {
		return { kind: "skip" };
	}
	if (ctx.protectedIds.has(pod.id)) {
		return { kind: "keep" };
	}
	const ageMs = podAgeMs(pod, ctx.now);
	if (ageMs === null || ageMs < ctx.safetyAgeMs) {
		return { kind: "keep" };
	}
	return { ageMs, kind: "reap" };
}

/**
 * Periodically kills RunPod pods that:
 *  - match one of our `namePrefixes` (so we don't touch unrelated tenants),
 *  - are still in `RUNNING` state,
 *  - are older than `safetyAgeMs` (to never abort an in-flight exec),
 *  - and are NOT present in the warm pool.
 *
 * The warm pool itself uses Redis TTL, so entries naturally expire after
 * `keepAliveMs`. Without this reaper an expired pod would keep running and
 * burning money. Reaper is the safety net that turns "soft TTL" into a real
 * resource bound.
 */
export function createPodReaper(options: ReaperOptions): PodReaper {
	const now = options.now ?? Date.now;
	const log = options.logger;
	let timer: ReturnType<typeof setInterval> | null = null;
	let inFlight = false;

	const reapPod = async (pod: PodSnapshot, ageMs: number): Promise<boolean> => {
		try {
			await options.api.delete(pod.id);
			log?.info?.("runpod-pod.reaper.terminated", {
				ageMs,
				name: pod.name,
				podId: pod.id,
			});
			return true;
		} catch (error) {
			log?.warn?.("runpod-pod.reaper.terminate-failed", {
				message: error instanceof Error ? error.message : String(error),
				podId: pod.id,
			});
			return false;
		}
	};

	const runOnce = async (): Promise<{ kept: number; reaped: string[] }> => {
		const liveSnapshots = await options.api.list();
		const warmEntries = await options.warmPool.list();
		const ctx = {
			namePrefixes: options.namePrefixes,
			now: now(),
			protectedIds: new Set(warmEntries.map((e) => e.podId)),
			safetyAgeMs: options.safetyAgeMs,
		};
		const reaped: string[] = [];
		let kept = 0;
		for (const pod of liveSnapshots) {
			const verdict = classifyPod(pod, ctx);
			if (verdict.kind === "keep") {
				kept += 1;
				continue;
			}
			if (verdict.kind === "reap" && (await reapPod(pod, verdict.ageMs))) {
				reaped.push(pod.id);
			}
		}
		if (reaped.length > 0 || kept > 0) {
			log?.info?.("runpod-pod.reaper.tick", {
				kept,
				reapedCount: reaped.length,
			});
		}
		return { kept, reaped };
	};

	const tick = async () => {
		if (inFlight) {
			return;
		}
		inFlight = true;
		try {
			await runOnce();
		} catch (error) {
			log?.warn?.("runpod-pod.reaper.tick-failed", {
				message: error instanceof Error ? error.message : String(error),
			});
		} finally {
			inFlight = false;
		}
	};

	timer = setInterval(() => {
		tick().catch(() => {
			// Already logged inside tick()
		});
	}, options.intervalMs);
	if (typeof timer === "object" && timer && "unref" in timer) {
		(timer as { unref?: () => void }).unref?.();
	}

	return {
		run: runOnce,
		stop() {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		},
	};
}

export function createRedisPodInputStore(redis: Redis): PodInputStore {
	return {
		async delete(requestId) {
			await redis.del(inputKey(requestId));
		},
		async get<T>(requestId: string) {
			const raw = await redis.get(inputKey(requestId));
			if (!raw) {
				return null;
			}
			try {
				return JSON.parse(raw) as T;
			} catch {
				return null;
			}
		},
		async put<T>(requestId: string, input: T, ttlMs: number) {
			await redis.set(inputKey(requestId), JSON.stringify(input), "PX", ttlMs);
		},
	};
}
