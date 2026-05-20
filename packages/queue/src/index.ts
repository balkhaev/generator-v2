import {
	type Job,
	type JobsOptions,
	type Processor,
	Queue,
	Worker,
	type WorkerOptions,
} from "bullmq";
import IORedis, { type Redis } from "ioredis";

export type { Job } from "bullmq";
// Re-export so callers don't need a direct bullmq dependency just to drive
// the standard "re-queue with delay without consuming an attempt" pattern.
// biome-ignore lint/performance/noBarrelFile: thin queue facade intentionally re-exports BullMQ's DelayedError
export { DelayedError } from "bullmq";
export type { Redis } from "ioredis";

const RELEASE_LOCK_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
	return redis.call('del', KEYS[1])
else
	return 0
end
`;

export interface IdempotencyLock {
	/**
	 * Atomically claim ownership of `key` for the configured TTL. Returns true
	 * only when the caller acquired the lock; subsequent callers competing for
	 * the same key get false until the lock expires or is explicitly released.
	 */
	acquire(key: string): Promise<boolean>;
	close(): Promise<void>;
	/**
	 * Best-effort release of a lock previously acquired by THIS instance. Locks
	 * owned by another process are left untouched, so a slow handler can never
	 * accidentally unlock a re-armed key.
	 */
	release(key: string): Promise<void>;
}

export interface IdempotencyLockStore {
	close(): Promise<void>;
	/** Delete the key only if its current value matches `value`. */
	deleteIfOwned(key: string, value: string): Promise<void>;
	/** SET key value EX ttlSeconds NX. Returns true on success. */
	setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

export interface CreateIdempotencyLockOptions {
	keyPrefix?: string;
	ownerToken?: string;
	store: IdempotencyLockStore;
	ttlSeconds: number;
}

export function createIdempotencyLock(
	options: CreateIdempotencyLockOptions
): IdempotencyLock {
	const prefix = options.keyPrefix ?? "idempotency";
	const ownerToken = options.ownerToken ?? crypto.randomUUID();
	const buildKey = (key: string) => `${prefix}:${key}`;

	return {
		acquire(key) {
			return options.store.setNx(buildKey(key), ownerToken, options.ttlSeconds);
		},
		release(key) {
			return options.store.deleteIfOwned(buildKey(key), ownerToken);
		},
		close() {
			return options.store.close();
		},
	};
}

export function createRedisIdempotencyLockStore(options: {
	redisUrl: string;
}): IdempotencyLockStore {
	const connection: Redis = new IORedis(options.redisUrl, {
		maxRetriesPerRequest: 3,
	});

	return {
		async setNx(key, value, ttlSeconds) {
			const result = await connection.set(key, value, "EX", ttlSeconds, "NX");
			return result === "OK";
		},
		async deleteIfOwned(key, value) {
			await connection.eval(RELEASE_LOCK_LUA, 1, key, value);
		},
		async close() {
			await connection.quit();
		},
	};
}

export function createRedisIdempotencyLock(options: {
	redisUrl: string;
	ttlSeconds: number;
	keyPrefix?: string;
	ownerToken?: string;
}): IdempotencyLock {
	return createIdempotencyLock({
		store: createRedisIdempotencyLockStore({ redisUrl: options.redisUrl }),
		ttlSeconds: options.ttlSeconds,
		keyPrefix: options.keyPrefix,
		ownerToken: options.ownerToken,
	});
}

/**
 * Convenience helper: acquires a lock keyed by `key`, runs `task`, and keeps
 * the lock in place for the full TTL on success. On failure the lock is
 * released so an operator-triggered retry (or a redelivered queue/event
 * message) can be processed normally.
 *
 * Returns:
 *   - { acquired: true, result } when the task ran
 *   - { acquired: false } when another worker already owns the lock
 */
export async function withIdempotency<T>(
	lock: IdempotencyLock,
	key: string,
	task: () => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false }> {
	const acquired = await lock.acquire(key);
	if (!acquired) {
		return { acquired: false };
	}

	try {
		const result = await task();
		return { acquired: true, result };
	} catch (error) {
		await lock.release(key).catch(() => {
			// ignore release errors so the original error is propagated
		});
		throw error;
	}
}

export const queueNames = {
	adminPersonLoraTraining: "admin-person-lora-training",
	generatorExecution: "generator-execution",
	personsPromptGeneration: "persons-prompt-generation",
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];

export function createRedisConnection(redisUrl: string) {
	return new IORedis(redisUrl, {
		maxRetriesPerRequest: null,
	});
}

export interface RedisPublisher {
	close(): Promise<void>;
	/**
	 * Returns the number of Redis clients that received the message (raw
	 * PUBLISH reply). 0 is common in horizontally scaled deployments where
	 * a single instance only happens to talk to a different shard; callers
	 * generally shouldn't act on this value.
	 */
	publish(channel: string, payload: string): Promise<number>;
}

/**
 * Lightweight Redis publisher for fire-and-forget pub/sub events
 * (e.g. config-change notifications consumed by other services).
 *
 * Uses bounded retries + offline-queue disabled so a flaky Redis cannot
 * stall HTTP handlers that publish from a request hot path.
 */
export function createRedisPublisher(redisUrl: string): RedisPublisher {
	const connection: Redis = new IORedis(redisUrl, {
		commandTimeout: 1500,
		connectTimeout: 2000,
		enableOfflineQueue: false,
		maxRetriesPerRequest: 2,
	});
	return {
		async close() {
			await connection.quit();
		},
		publish(channel, payload) {
			return connection.publish(channel, payload);
		},
	};
}

export interface RedisSubscriber {
	close(): Promise<void>;
}

export interface CreateRedisSubscriberOptions {
	channel: string;
	logger?: Pick<Console, "error" | "warn">;
	onMessage(payload: string): void | Promise<void>;
	redisUrl: string;
}

/**
 * Subscribe to a single channel and invoke `onMessage` for each delivery.
 *
 * Notes:
 * - Uses default `maxRetriesPerRequest: null` so reconnects keep the
 *   subscription alive across Redis restarts/network blips.
 * - `onMessage` exceptions are caught and logged so a single bad handler
 *   doesn't tear down the subscriber.
 */
export function createRedisSubscriber(
	options: CreateRedisSubscriberOptions
): RedisSubscriber {
	const connection: Redis = new IORedis(options.redisUrl, {
		maxRetriesPerRequest: null,
	});
	connection.subscribe(options.channel).catch((error: unknown) =>
		options.logger?.error?.("redis.subscribe.failed", {
			channel: options.channel,
			message: error instanceof Error ? error.message : "unknown",
		})
	);
	connection.on("message", (incomingChannel: string, payload: string) => {
		if (incomingChannel !== options.channel) {
			return;
		}
		try {
			const result = options.onMessage(payload);
			if (result && typeof (result as Promise<void>).then === "function") {
				(result as Promise<void>).catch((error: unknown) =>
					options.logger?.error?.("redis.subscribe.handler.failed", {
						channel: options.channel,
						message: error instanceof Error ? error.message : "unknown",
					})
				);
			}
		} catch (error) {
			options.logger?.error?.("redis.subscribe.handler.failed", {
				channel: options.channel,
				message: error instanceof Error ? error.message : "unknown",
			});
		}
	});
	return {
		async close() {
			await connection.quit();
		},
	};
}

export interface CreateAppRedisConnectionOptions {
	/** ms; default 1500. Caps how long a single command may wait. */
	commandTimeout?: number;
	/** ms; default 2000. Caps initial TCP/TLS connect. */
	connectTimeout?: number;
	/** default 2. Bounded retries so a flapping Redis cannot stall callers. */
	maxRetriesPerRequest?: number;
}

/**
 * Redis connection for low-latency application reads (settings, feature flags,
 * cached lookups) sitting on a request hot path.
 *
 * Why this exists: `createRedisConnection` is tuned for BullMQ workers and uses
 * `maxRetriesPerRequest: null` + the default `enableOfflineQueue: true`. That
 * combination intentionally queues commands forever while the client tries to
 * reconnect. For a worker that's correct; for an HTTP request handler it means
 * a single Redis blip turns into requests hanging until the process is killed.
 *
 * This variant fails fast instead: bounded retries, an explicit
 * `commandTimeout`, `enableOfflineQueue: false` (so calls reject immediately
 * when the socket is down), and a finite `connectTimeout`. Callers should
 * still treat Redis as best-effort and fall back to defaults on rejection.
 */
export function createAppRedisConnection(
	redisUrl: string,
	options: CreateAppRedisConnectionOptions = {}
) {
	return new IORedis(redisUrl, {
		commandTimeout: options.commandTimeout ?? 1500,
		connectTimeout: options.connectTimeout ?? 2000,
		enableOfflineQueue: false,
		maxRetriesPerRequest: options.maxRetriesPerRequest ?? 2,
	});
}

export function createQueueClient<T>(
	name: QueueName,
	options: {
		defaultJobOptions?: JobsOptions;
		redisUrl: string;
	}
) {
	const connection = createRedisConnection(options.redisUrl);
	const queue = new Queue<T, void, string>(name, {
		connection,
		defaultJobOptions: options.defaultJobOptions,
	});

	return {
		async add(jobName: string, data: T, jobOptions?: JobsOptions) {
			await queue.add(jobName as never, data as never, jobOptions);
		},
		async close() {
			await queue.close();
			await connection.quit();
		},
	};
}

export function createQueueWorker<T>(
	name: QueueName,
	options: {
		concurrency?: number;
		onCompleted?: (job: Job<T, void, string>) => void;
		onFailed?: (job: Job<T, void, string> | undefined, error: Error) => void;
		processor: Processor<T, void, string>;
		redisUrl: string;
		worker?: Omit<WorkerOptions, "connection" | "concurrency">;
	}
) {
	const connection = createRedisConnection(options.redisUrl);
	const worker = new Worker<T, void, string>(name, options.processor, {
		connection,
		concurrency: options.concurrency ?? 1,
		...(options.worker ?? {}),
	});

	if (options.onCompleted) {
		worker.on("completed", (job) => options.onCompleted?.(job));
	}
	if (options.onFailed) {
		worker.on("failed", (job, error) => options.onFailed?.(job, error));
	}

	return {
		async close() {
			await worker.close();
			await connection.quit();
		},
		worker,
	};
}
