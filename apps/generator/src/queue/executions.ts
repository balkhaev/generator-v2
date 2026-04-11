import {
	createQueueClient,
	createQueueWorker,
	queueNames,
} from "@generator/queue";

export type GeneratorExecutionQueue = {
	enqueueSubmit(input: { executionId: string }): Promise<void>;
	enqueueSync(input: { executionId: string; delayMs?: number }): Promise<void>;
};

type CreateGeneratorExecutionQueueOptions = {
	concurrency?: number;
	handler: (job: {
		data: { executionId: string };
		name: "submit" | "sync";
	}) => Promise<void>;
	logger?: Pick<Console, "error" | "info">;
	onJobExhausted?: (executionId: string, error: Error) => Promise<void>;
	redisUrl: string;
};

const DEFAULT_SYNC_DELAY_MS = 5000;

export type GeneratorExecutionWorkerRuntime = {
	close: () => Promise<void>;
};

export function createGeneratorExecutionQueueClient(
	redisUrl: string
): GeneratorExecutionQueue {
	const queueClient = createQueueClient<{ executionId: string }>(
		queueNames.generatorExecution,
		{
			redisUrl,
		}
	);

	return {
		async enqueueSubmit(input) {
			await queueClient.add("submit", input, {
				jobId: `submit-${input.executionId}`,
				attempts: 3,
				backoff: { type: "exponential", delay: 5000 },
			});
		},
		async enqueueSync(input) {
			await queueClient.add(
				"sync",
				{ executionId: input.executionId },
				{
					delay: input.delayMs ?? DEFAULT_SYNC_DELAY_MS,
					attempts: 2,
					backoff: { type: "exponential", delay: 3000 },
					removeOnComplete: true,
					removeOnFail: true,
				}
			);
		},
	};
}

export function createGeneratorExecutionWorker(
	options: CreateGeneratorExecutionQueueOptions
): GeneratorExecutionWorkerRuntime {
	const logger = options.logger ?? console;

	return createQueueWorker<{ executionId: string }>(
		queueNames.generatorExecution,
		{
			concurrency: options.concurrency ?? 5,
			onCompleted: (job) => {
				logger.info("generator.execution-job.completed", {
					executionId: job.data.executionId,
					jobName: job.name,
				});
			},
			onFailed: async (job, error) => {
				const isRetryExhausted =
					job !== undefined && job.attemptsMade >= (job.opts?.attempts ?? 0);
				logger.error("generator.execution-job.failed", {
					attemptsMade: job?.attemptsMade ?? 0,
					error: error.message,
					executionId: job?.data.executionId ?? null,
					jobName: job?.name ?? null,
					retriesExhausted: isRetryExhausted,
				});
				if (
					isRetryExhausted &&
					job?.data.executionId &&
					options.onJobExhausted
				) {
					await options
						.onJobExhausted(job.data.executionId, error)
						.catch((callbackError) => {
							logger.error("generator.execution-job.exhausted-handler-failed", {
								error:
									callbackError instanceof Error
										? callbackError.message
										: "unknown",
								executionId: job.data.executionId,
							});
						});
				}
			},
			processor: async (job) => {
				if (job.name !== "submit" && job.name !== "sync") {
					throw new Error(`Unsupported generator execution job: ${job.name}`);
				}
				await options.handler({
					data: job.data,
					name: job.name,
				});
			},
			redisUrl: options.redisUrl,
		}
	);
}
