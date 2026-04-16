import {
	createQueueClient,
	createQueueWorker,
	queueNames,
} from "@generator/queue";

export interface PersonLoraTrainingJobData {
	description?: string;
	outputName?: string;
	personId: string;
	personName: string;
	personSlug: string;
	referencePhotoUrl: string;
	referencePrompt?: string;
	trainingRunId: string;
	triggerWord?: string;
}

export interface PersonLoraTrainingQueue {
	enqueue(input: PersonLoraTrainingJobData): Promise<string>;
}

export interface PersonLoraTrainingWorkerRuntime {
	close: () => Promise<void>;
}

export function createPersonLoraTrainingQueueClient(
	redisUrl: string
): PersonLoraTrainingQueue {
	const queueClient = createQueueClient<PersonLoraTrainingJobData>(
		queueNames.adminPersonLoraTraining,
		{
			redisUrl,
		}
	);

	return {
		async enqueue(input) {
			const jobId = `person-lora-training-${input.personId}-${crypto.randomUUID()}`;
			await queueClient.add("run", input, {
				jobId,
			});
			return jobId;
		},
	};
}

export function createPersonLoraTrainingWorker(options: {
	handler: (job: {
		data: PersonLoraTrainingJobData;
		name: "run";
	}) => Promise<void>;
	logger?: Pick<Console, "error" | "info">;
	redisUrl: string;
}): PersonLoraTrainingWorkerRuntime {
	const logger = options.logger ?? console;

	return createQueueWorker<PersonLoraTrainingJobData>(
		queueNames.adminPersonLoraTraining,
		{
			onCompleted: (job: { id?: string; data: PersonLoraTrainingJobData }) => {
				logger.info("admin.person-lora-training.completed", {
					jobId: job.id,
					personId: job.data.personId,
				});
			},
			onFailed: (
				job: { id?: string; data: PersonLoraTrainingJobData } | undefined,
				error: Error
			) => {
				logger.error("admin.person-lora-training.failed", {
					error: error.message,
					jobId: job?.id ?? null,
					personId: job?.data.personId ?? null,
				});
			},
			processor: async (job: {
				data: PersonLoraTrainingJobData;
				name: string;
			}) => {
				if (job.name !== "run") {
					throw new Error(`Unsupported person lora training job: ${job.name}`);
				}
				await options.handler({
					data: job.data,
					name: "run",
				});
			},
			redisUrl: options.redisUrl,
		}
	);
}
