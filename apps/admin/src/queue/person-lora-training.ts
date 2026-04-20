import type {
	ApprovedDatasetItem,
	PersonDatasetVariantRefillRequest,
} from "@generator/events";
import {
	createQueueClient,
	createQueueWorker,
	queueNames,
} from "@generator/queue";

interface SeedReferenceImage {
	caption: string;
	s3Key?: string | null;
	url: string;
	variantId: string;
}

export interface PersonLoraTrainingJobData {
	debugCorrelationId?: string;
	description?: string;
	mode?: "prep-only" | "auto-train";
	outputName?: string;
	personId: string;
	personName: string;
	personSlug: string;
	referencePhotoUrl: string;
	referencePrompt?: string;
	/**
	 * URL уже готового reference-zip от предыдущей успешной тренировки. Если
	 * задан — runner пропустит fal.ai-генерацию и подаст этот zip pod'у через
	 * DATASET_URL.
	 */
	reuseDatasetUrl?: string;
	seedReferenceImages?: SeedReferenceImage[];
	trainingRunId: string;
	triggerWord?: string;
}

export interface PersonLoraTrainingConfirmationJobData
	extends PersonLoraTrainingJobData {
	approvedItems: ApprovedDatasetItem[];
}

export type PersonLoraTrainingWorkerJob =
	| {
			data: PersonLoraTrainingConfirmationJobData;
			name: "confirm";
	  }
	| {
			data: PersonDatasetVariantRefillRequest;
			name: "refill";
	  }
	| {
			data: PersonLoraTrainingJobData;
			name: "run";
	  };

type PersonLoraTrainingQueueJobData =
	| PersonDatasetVariantRefillRequest
	| PersonLoraTrainingConfirmationJobData
	| PersonLoraTrainingJobData;

export interface PersonLoraTrainingEnqueueOptions {
	jobId?: string;
}

export interface PersonLoraTrainingQueue {
	close: () => Promise<void>;
	enqueue(
		input: PersonLoraTrainingJobData,
		options?: PersonLoraTrainingEnqueueOptions
	): Promise<string>;
	enqueueConfirmation(
		input: PersonLoraTrainingConfirmationJobData,
		options?: PersonLoraTrainingEnqueueOptions
	): Promise<string>;
	enqueueRefill(
		input: PersonDatasetVariantRefillRequest,
		options?: PersonLoraTrainingEnqueueOptions
	): Promise<string>;
}

export interface PersonLoraTrainingWorkerRuntime {
	close: () => Promise<void>;
}

export function createPersonLoraTrainingQueueClient(
	redisUrl: string
): PersonLoraTrainingQueue {
	const queueClient = createQueueClient<PersonLoraTrainingQueueJobData>(
		queueNames.adminPersonLoraTraining,
		{
			redisUrl,
		}
	);

	return {
		close() {
			return queueClient.close();
		},
		async enqueue(input, options) {
			const jobId =
				options?.jobId ??
				`person-lora-training-${input.personId}-${crypto.randomUUID()}`;
			await queueClient.add("run", input, {
				jobId,
			});
			return jobId;
		},
		async enqueueConfirmation(input, options) {
			const jobId =
				options?.jobId ??
				`person-lora-training-confirm-${input.personId}-${crypto.randomUUID()}`;
			await queueClient.add("confirm", input, {
				jobId,
			});
			return jobId;
		},
		async enqueueRefill(input, options) {
			const jobId =
				options?.jobId ??
				`person-dataset-refill-${input.personId}-${input.variantId}-${crypto.randomUUID()}`;
			await queueClient.add("refill", input, {
				jobId,
			});
			return jobId;
		},
	};
}

export function createPersonLoraTrainingWorker(options: {
	handler: (job: PersonLoraTrainingWorkerJob) => Promise<void>;
	logger?: Pick<Console, "error" | "info">;
	redisUrl: string;
}): PersonLoraTrainingWorkerRuntime {
	const logger = options.logger ?? console;

	return createQueueWorker<
		| PersonDatasetVariantRefillRequest
		| PersonLoraTrainingConfirmationJobData
		| PersonLoraTrainingJobData
	>(queueNames.adminPersonLoraTraining, {
		onCompleted: (job) => {
			logger.info("admin.person-lora-training.completed", {
				jobId: job.id,
				jobName: job.name,
				personId:
					"personId" in job.data && typeof job.data.personId === "string"
						? job.data.personId
						: null,
			});
		},
		onFailed: (job, error: Error) => {
			logger.error("admin.person-lora-training.failed", {
				error: error.message,
				jobId: job?.id ?? null,
				jobName: job?.name ?? null,
				personId:
					job?.data &&
					"personId" in job.data &&
					typeof job.data.personId === "string"
						? job.data.personId
						: null,
			});
		},
		processor: async (job: {
			data:
				| PersonDatasetVariantRefillRequest
				| PersonLoraTrainingConfirmationJobData
				| PersonLoraTrainingJobData;
			name: string;
		}) => {
			if (job.name === "confirm") {
				await options.handler({
					data: job.data as PersonLoraTrainingConfirmationJobData,
					name: "confirm",
				});
				return;
			}
			if (job.name === "refill") {
				await options.handler({
					data: job.data as PersonDatasetVariantRefillRequest,
					name: "refill",
				});
				return;
			}
			if (job.name !== "run") {
				throw new Error(`Unsupported person lora training job: ${job.name}`);
			}
			await options.handler({
				data: job.data as PersonLoraTrainingJobData,
				name: "run",
			});
		},
		redisUrl: options.redisUrl,
	});
}
