/**
 * Pool of warm RunPod pods that have already booted ComfyUI and loaded models
 * into VRAM. Burst submits within `PodSpec.keepAliveMs` reuse these pods to
 * skip the ~5–30 min cold boot.
 *
 * Contract:
 * - `claim` is **atomic** (read + remove). If two worker processes race for
 *   the same pod, only one wins; the other gets `null` and creates a new pod.
 * - `release` overwrites any existing entry for `(workflowId, podId)` with a
 *   fresh TTL. Idempotent.
 * - `forget` is best-effort; missing entries are not an error.
 * - All TTL bookkeeping is the implementation's responsibility (Redis EX, etc).
 *   Reaper that actually terminates expired pods on RunPod lives outside this
 *   interface — pool only tracks "this pod is still considered hot".
 */
export interface WarmPodEntry {
	networkVolumeId: string;
	/** PASSWORD env var used to bootstrap ComfyUI Basic-Auth on the live pod. */
	password: string;
	podId: string;
}

export interface WarmPodPool {
	/**
	 * Atomically pull one usable warm pod for `workflowId` out of the pool.
	 * Pool is responsible for skipping/removing entries with expired TTL. Returns
	 * `null` when no warm pod is available; callers must then create a fresh one.
	 */
	claim(workflowId: string): Promise<WarmPodEntry | null>;
	/**
	 * Best-effort removal of an entry — used when caller decided pod is dead
	 * (404 from RunPod, container crashed, exec failed, etc).
	 */
	forget(workflowId: string, podId: string): Promise<void>;
	/**
	 * List all warm entries across the pool. Reaper uses this to diff against
	 * the live RunPod inventory and terminate orphan pods. Tests rely on it
	 * to assert pool state without poking the storage backend.
	 */
	list(): Promise<Array<WarmPodEntry & { workflowId: string }>>;
	/**
	 * Put `entry` into the pool with `ttlMs` lifetime. After the TTL elapses,
	 * subsequent `claim`s must skip it as if it were never released.
	 */
	release(
		workflowId: string,
		entry: WarmPodEntry,
		ttlMs: number
	): Promise<void>;
}

/**
 * Per-request input cache. When a warm pod is reused across exec'es, the new
 * input cannot ride in the pod's env (env is fixed at pod creation). So the
 * engine stores the input in this side-channel at submit time and reads it
 * back from each `getStatus` poll.
 *
 * Disposable pods (no warm-pool reuse) keep using the env-only path, so this
 * store is only consulted when env doesn't have the input. Entries should be
 * scoped per `requestId` and cleaned up on terminal states.
 */
export interface PodInputStore {
	delete(requestId: string): Promise<void>;
	get<T>(requestId: string): Promise<T | null>;
	put<T>(requestId: string, input: T, ttlMs: number): Promise<void>;
}

/**
 * Registry of pods currently *owned* by an in-flight execution. Reaper consults
 * it together with `WarmPodPool` to build the protected-from-reap set: anything
 * in the active registry must not be touched, regardless of age.
 *
 * Lifecycle:
 * - pod-engine calls `add` immediately after `api.create` succeeds (or right
 *   after claiming a warm pod for reuse), with a TTL slightly larger than the
 *   workflow's max execution time;
 * - pod-engine calls `remove` on success (after warm-pool release), on
 *   cleanup (failure / cancel / artifact missing), and whenever the pod is
 *   intentionally terminated;
 * - if pod-engine crashes between `add` and `remove`, the entry expires on its
 *   own and reaper takes over via `safetyAgeMs` as a real safety net.
 *
 * Without this registry reaper has no way to tell "newly-created pod still
 * booting models for 30+ min" from "abandoned pod left running by a dead
 * worker", so it must rely on a fragile age threshold. The registry promotes
 * that threshold to a true backstop.
 */
export interface ActivePodEntry {
	networkVolumeId: string;
	podId: string;
	/** ISO timestamp of registration; debugging only. */
	registeredAt: string;
	workflowId: string;
}

export interface ActivePodRegistry {
	add(entry: ActivePodEntry, ttlMs: number): Promise<void>;
	list(): Promise<ActivePodEntry[]>;
	remove(podId: string): Promise<void>;
}

const NOOP_ACTIVE_REGISTRY: ActivePodRegistry = {
	add() {
		return Promise.resolve();
	},
	list() {
		return Promise.resolve([]);
	},
	remove() {
		return Promise.resolve();
	},
};

const NOOP_WARM_POOL: WarmPodPool = {
	claim() {
		return Promise.resolve(null);
	},
	forget() {
		return Promise.resolve();
	},
	list() {
		return Promise.resolve([]);
	},
	release() {
		return Promise.resolve();
	},
};

const NOOP_INPUT_STORE: PodInputStore = {
	delete() {
		return Promise.resolve();
	},
	get() {
		return Promise.resolve(null);
	},
	put() {
		return Promise.resolve();
	},
};

/** Default deps: no reuse, no cross-process input cache. */
export function createNoopWarmPodPool(): WarmPodPool {
	return NOOP_WARM_POOL;
}

export function createNoopPodInputStore(): PodInputStore {
	return NOOP_INPUT_STORE;
}

export function createNoopActivePodRegistry(): ActivePodRegistry {
	return NOOP_ACTIVE_REGISTRY;
}

/**
 * In-memory active-pod registry. TTL is enforced lazily on `list`, mirroring
 * the warm-pool semantics so tests can share `now()` injection.
 */
export function createInMemoryActivePodRegistry(options?: {
	now?: () => number;
}): ActivePodRegistry {
	const now = options?.now ?? Date.now;
	const entries = new Map<
		string,
		{ entry: ActivePodEntry; expiresAt: number }
	>();

	const purgeExpired = (): void => {
		const ts = now();
		for (const [id, slot] of entries) {
			if (slot.expiresAt <= ts) {
				entries.delete(id);
			}
		}
	};

	return {
		add(entry, ttlMs) {
			entries.set(entry.podId, { entry, expiresAt: now() + ttlMs });
			return Promise.resolve();
		},
		list() {
			purgeExpired();
			return Promise.resolve(Array.from(entries.values(), (s) => s.entry));
		},
		remove(podId) {
			entries.delete(podId);
			return Promise.resolve();
		},
	};
}

/**
 * In-memory implementation used in tests and as a sane single-process default.
 * Entries past their `expiresAt` are skipped on `claim` and dropped lazily.
 */
export function createInMemoryWarmPodPool(options?: {
	now?: () => number;
}): WarmPodPool {
	const now = options?.now ?? Date.now;
	const buckets = new Map<
		string,
		Array<{ entry: WarmPodEntry; expiresAt: number }>
	>();

	const purgeExpired = (workflowId: string): void => {
		const bucket = buckets.get(workflowId);
		if (!bucket) {
			return;
		}
		const ts = now();
		const fresh = bucket.filter((b) => b.expiresAt > ts);
		if (fresh.length === 0) {
			buckets.delete(workflowId);
		} else {
			buckets.set(workflowId, fresh);
		}
	};

	return {
		claim(workflowId) {
			purgeExpired(workflowId);
			const bucket = buckets.get(workflowId);
			if (!bucket || bucket.length === 0) {
				return Promise.resolve(null);
			}
			const next = bucket.shift();
			if (bucket.length === 0) {
				buckets.delete(workflowId);
			}
			return Promise.resolve(next?.entry ?? null);
		},
		forget(workflowId, podId) {
			const bucket = buckets.get(workflowId);
			if (!bucket) {
				return Promise.resolve();
			}
			const fresh = bucket.filter((b) => b.entry.podId !== podId);
			if (fresh.length === 0) {
				buckets.delete(workflowId);
			} else {
				buckets.set(workflowId, fresh);
			}
			return Promise.resolve();
		},
		list() {
			const ts = now();
			const out: Array<WarmPodEntry & { workflowId: string }> = [];
			for (const [workflowId, bucket] of buckets.entries()) {
				for (const item of bucket) {
					if (item.expiresAt > ts) {
						out.push({ ...item.entry, workflowId });
					}
				}
			}
			return Promise.resolve(out);
		},
		release(workflowId, entry, ttlMs) {
			const bucket = buckets.get(workflowId) ?? [];
			const without = bucket.filter((b) => b.entry.podId !== entry.podId);
			without.push({ entry, expiresAt: now() + ttlMs });
			buckets.set(workflowId, without);
			return Promise.resolve();
		},
	};
}

export function createInMemoryPodInputStore(options?: {
	now?: () => number;
}): PodInputStore {
	const now = options?.now ?? Date.now;
	const entries = new Map<string, { expiresAt: number; value: unknown }>();

	const purgeIfExpired = (requestId: string): void => {
		const entry = entries.get(requestId);
		if (entry && entry.expiresAt <= now()) {
			entries.delete(requestId);
		}
	};

	return {
		delete(requestId) {
			entries.delete(requestId);
			return Promise.resolve();
		},
		get<T>(requestId: string) {
			purgeIfExpired(requestId);
			const entry = entries.get(requestId);
			return Promise.resolve((entry?.value ?? null) as T | null);
		},
		put<T>(requestId: string, input: T, ttlMs: number) {
			entries.set(requestId, { expiresAt: now() + ttlMs, value: input });
			return Promise.resolve();
		},
	};
}
