import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
export const queueNames = {
	adminPersonLoraTraining: "admin-person-lora-training",
	generatorExecution: "generator-execution",
	personsPromptGeneration: "persons-prompt-generation",
};
export function createRedisConnection(redisUrl) {
	return new IORedis(redisUrl, {
		maxRetriesPerRequest: null,
	});
}
export function createQueueClient(name, options) {
	const connection = createRedisConnection(options.redisUrl);
	const queue = new Queue(name, {
		connection,
		defaultJobOptions: options.defaultJobOptions,
	});
	return {
		async add(jobName, data, jobOptions) {
			await queue.add(jobName, data, jobOptions);
		},
		async close() {
			await queue.close();
			await connection.quit();
		},
	};
}
export function createQueueWorker(name, options) {
	const connection = createRedisConnection(options.redisUrl);
	const worker = new Worker(name, options.processor, {
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
