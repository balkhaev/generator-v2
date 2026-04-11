import {
	type Job,
	type JobsOptions,
	type Processor,
	Queue,
	Worker,
	type WorkerOptions,
} from "bullmq";
import IORedis from "ioredis";

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
			await queue.add(jobName, data, jobOptions);
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
