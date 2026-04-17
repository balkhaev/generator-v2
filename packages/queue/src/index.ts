import {
	type Job,
	type JobsOptions,
	type Processor,
	Queue,
	Worker,
	type WorkerOptions,
} from "bullmq";
import IORedis, { type Redis } from "ioredis";

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
