/**
 * Cross-process settings handover between admin-worker and admin-api gateway.
 *
 * Backstory: secrets like RUNPOD_API_KEY and RUNPOD_AI_TOOLKIT_ENDPOINT_ID live only
 * on the worker (the only process that actually contacts the providers). The
 * gateway serves the /api/admin/settings UI but doesn't have those env vars,
 * so a naive `resolveTrainingProviderAvailability(process.env)` on the gateway
 * always reports "not configured" — which is misleading.
 *
 * Fix: the worker periodically publishes a snapshot of its own settings into
 * Redis (single key, TTL ~3x the heartbeat interval). The gateway reads it
 * during request handling and uses it as the source of truth. If the snapshot
 * is missing or stale, the gateway falls back to its own env (so single-process
 * dev still works) and the UI surfaces a warning via `AdminWorkerHealthStatus`.
 */

import type { TrainingProviderAvailability } from "@generator/contracts/admin";
import { createRedisConnection } from "@generator/queue";

type RedisConnection = ReturnType<typeof createRedisConnection>;

export const WORKER_SETTINGS_REDIS_KEY = "admin:worker-settings";

/**
 * Heartbeat published by the worker. Default TTL = 3 * publish interval, so a
 * single missed beat does not invalidate the snapshot but a dead worker is
 * detected within a minute.
 */
export const DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_WORKER_SNAPSHOT_TTL_SECONDS = 120;
export const DEFAULT_WORKER_FRESHNESS_THRESHOLD_MS = 90_000;

export interface WorkerSettingsSnapshot {
	availability: TrainingProviderAvailability[];
	publishedAt: string;
	runpod: {
		baseModel: string | null;
		bootstrapUrl: string | null;
		endpointConfigured: boolean;
		endpointId: string | null;
		mode: "serverless" | "pod" | null;
		podGpuTypeIds: string[] | null;
		podImageName: string | null;
		podTemplateId: string | null;
		pollMs: number | null;
		timeoutMs: number | null;
	};
}

export interface WorkerSettingsPublisher {
	close(): Promise<void>;
	publish(snapshot: Omit<WorkerSettingsSnapshot, "publishedAt">): Promise<void>;
}

export interface WorkerSettingsReader {
	close(): Promise<void>;
	read(): Promise<WorkerSettingsSnapshot | null>;
}

interface PublisherOptions {
	redisUrl: string;
	ttlSeconds?: number;
}

interface ReaderOptions {
	redisUrl: string;
}

export function createRedisWorkerSettingsPublisher(
	options: PublisherOptions
): WorkerSettingsPublisher {
	const connection: RedisConnection = createRedisConnection(options.redisUrl);
	const ttl = options.ttlSeconds ?? DEFAULT_WORKER_SNAPSHOT_TTL_SECONDS;

	return {
		async publish(input) {
			const snapshot: WorkerSettingsSnapshot = {
				...input,
				publishedAt: new Date().toISOString(),
			};
			await connection.set(
				WORKER_SETTINGS_REDIS_KEY,
				JSON.stringify(snapshot),
				"EX",
				ttl
			);
		},
		async close() {
			await connection.quit();
		},
	};
}

export function createRedisWorkerSettingsReader(
	options: ReaderOptions
): WorkerSettingsReader {
	const connection: RedisConnection = createRedisConnection(options.redisUrl);

	return {
		async read() {
			try {
				const value = await connection.get(WORKER_SETTINGS_REDIS_KEY);
				if (!value) {
					return null;
				}
				return parseSnapshot(value);
			} catch {
				return null;
			}
		},
		async close() {
			await connection.quit();
		},
	};
}

function parseSnapshot(raw: string): WorkerSettingsSnapshot | null {
	try {
		const value = JSON.parse(raw) as Partial<WorkerSettingsSnapshot> & {
			availability?: unknown;
			runpod?: unknown;
		};
		if (!Array.isArray(value.availability)) {
			return null;
		}
		const runpod = value.runpod as
			| Partial<WorkerSettingsSnapshot["runpod"]>
			| undefined;
		if (!runpod || typeof runpod !== "object") {
			return null;
		}
		if (typeof value.publishedAt !== "string") {
			return null;
		}
		return {
			availability: value.availability as TrainingProviderAvailability[],
			publishedAt: value.publishedAt,
			runpod: {
				baseModel: runpod.baseModel ?? null,
				bootstrapUrl: runpod.bootstrapUrl ?? null,
				endpointConfigured: Boolean(runpod.endpointConfigured),
				endpointId: runpod.endpointId ?? null,
				mode:
					runpod.mode === "serverless" || runpod.mode === "pod"
						? runpod.mode
						: null,
				podGpuTypeIds: Array.isArray(runpod.podGpuTypeIds)
					? (runpod.podGpuTypeIds.filter(
							(value) => typeof value === "string"
						) as string[])
					: null,
				podImageName: runpod.podImageName ?? null,
				podTemplateId: runpod.podTemplateId ?? null,
				pollMs: runpod.pollMs ?? null,
				timeoutMs: runpod.timeoutMs ?? null,
			},
		};
	} catch {
		return null;
	}
}

/**
 * Heartbeat scheduler: invokes the publisher immediately and on every
 * `intervalMs`. Returns a stop function for graceful shutdown. Errors are
 * logged via the optional logger but never propagate (heartbeat must not crash
 * the worker).
 */
export function startWorkerSettingsHeartbeat(input: {
	build(): Omit<WorkerSettingsSnapshot, "publishedAt">;
	intervalMs?: number;
	logger?: Pick<Console, "warn">;
	publisher: WorkerSettingsPublisher;
}): () => void {
	const intervalMs = input.intervalMs ?? DEFAULT_WORKER_HEARTBEAT_INTERVAL_MS;

	const publish = async () => {
		try {
			await input.publisher.publish(input.build());
		} catch (error) {
			input.logger?.warn("admin.worker.settings-heartbeat-failed", {
				message: error instanceof Error ? error.message : "unknown",
			});
		}
	};

	publish().catch(() => {
		// publish() already logs; this only satisfies the linter for a deliberate
		// fire-and-forget initial heartbeat before the interval starts.
	});
	const handle = setInterval(publish, intervalMs);
	return () => {
		clearInterval(handle);
	};
}

/**
 * Treats a snapshot as fresh if `publishedAt` is within the threshold (default
 * 90s). A missing snapshot is never fresh.
 */
export function isWorkerSnapshotFresh(
	snapshot: WorkerSettingsSnapshot | null,
	thresholdMs = DEFAULT_WORKER_FRESHNESS_THRESHOLD_MS,
	now: () => number = Date.now
): boolean {
	if (!snapshot) {
		return false;
	}
	const publishedAt = Date.parse(snapshot.publishedAt);
	if (Number.isNaN(publishedAt)) {
		return false;
	}
	return now() - publishedAt <= thresholdMs;
}

export function snapshotAgeSeconds(
	snapshot: WorkerSettingsSnapshot | null,
	now: () => number = Date.now
): number | null {
	if (!snapshot) {
		return null;
	}
	const publishedAt = Date.parse(snapshot.publishedAt);
	if (Number.isNaN(publishedAt)) {
		return null;
	}
	return Math.max(0, Math.round((now() - publishedAt) / 1000));
}
