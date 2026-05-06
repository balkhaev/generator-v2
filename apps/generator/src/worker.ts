import { env, getKafkaEventBusConfig } from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import {
	type AnyWorkflowDefinition,
	createFooocusSdxlWorkflow,
	createLtx23VideoWorkflow,
	createRunpodService,
} from "@generator/runpod";
import { resolveS3StorageConfig } from "@generator/storage";

import { ExecutionService } from "@/domain/executions";
import { createCivitaiClient } from "@/providers/civitai";
import { createFalClient } from "@/providers/fal";
import { createInferenceRouter } from "@/providers/inference-router";
import { createReplicateClient } from "@/providers/replicate";
import { createRunpodClient } from "@/providers/runpod";
import {
	createProviderArtifactDownloadOptions,
	createStorageAdapter,
} from "@/providers/storage";
import {
	createGeneratorExecutionQueueClient,
	createGeneratorExecutionWorker,
} from "@/queue/executions";
import { createDrizzleExecutionRepository } from "@/repositories/executions";

function splitCsv(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

const redisUrl = env.REDIS_URL;
const civitaiApiKey = env.CIVITAI_API_KEY;
const falKey = env.FAL_KEY;
const replicateApiToken = env.REPLICATE_API_TOKEN;
const runpodApiKey = env.RUNPOD_API_KEY;
const runpodFooocusEndpointId = env.RUNPOD_FOOOCUS_ENDPOINT_ID;
const runpodLtx23TemplateId = env.RUNPOD_LTX23_POD_TEMPLATE_ID;
const kafkaConfig = getKafkaEventBusConfig("generator-worker");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "generator-worker" })
	: null;

const hasAnyRunpodWorkflow = Boolean(
	runpodApiKey && (runpodFooocusEndpointId || runpodLtx23TemplateId)
);

if (!(civitaiApiKey || falKey || replicateApiToken || hasAnyRunpodWorkflow)) {
	throw new Error(
		"At least one inference provider is required for the generator worker"
	);
}

const s3Config = resolveS3StorageConfig();
const storageAdapter = createStorageAdapter({
	config: s3Config,
	downloadOptions: createProviderArtifactDownloadOptions({ replicateApiToken }),
	logger: console,
});

const runpodWorkflows: AnyWorkflowDefinition[] = [];
if (runpodFooocusEndpointId) {
	runpodWorkflows.push(
		createFooocusSdxlWorkflow({ endpointId: runpodFooocusEndpointId })
	);
}
if (runpodLtx23TemplateId) {
	runpodWorkflows.push(
		createLtx23VideoWorkflow({
			pod: {
				cloudType: env.RUNPOD_LTX23_POD_CLOUD_TYPE,
				containerDiskInGb: env.RUNPOD_LTX23_POD_CONTAINER_DISK_GB,
				gpuTypeIds: splitCsv(env.RUNPOD_LTX23_POD_GPU_TYPE_IDS),
				imageName: env.RUNPOD_LTX23_POD_IMAGE_NAME,
				networkVolumeId: env.RUNPOD_LTX23_POD_NETWORK_VOLUME_ID,
				templateId: runpodLtx23TemplateId,
				timeoutMs: env.RUNPOD_LTX23_POD_TIMEOUT_MS,
				volumeInGb: env.RUNPOD_LTX23_POD_VOLUME_GB,
			},
		})
	);
}

const runpodService =
	runpodApiKey && runpodWorkflows.length > 0
		? createRunpodService({
				apiKey: runpodApiKey,
				civitaiApiKey,
				hfToken: env.HF_TOKEN ?? env.HUGGINGFACE_TOKEN,
				logger: console,
				podsBaseUrl: env.RUNPOD_REST_API_BASE_URL,
				s3: s3Config,
				serverlessBaseUrl: env.RUNPOD_API_BASE_URL,
				workflows: runpodWorkflows,
			})
		: null;

const inferenceClient = createInferenceRouter({
	civitai: civitaiApiKey
		? createCivitaiClient({
				apiBaseUrl: env.CIVITAI_API_BASE_URL,
				apiKey: civitaiApiKey,
			})
		: undefined,
	fal: falKey ? createFalClient({ apiKey: falKey }) : undefined,
	replicate: replicateApiToken
		? createReplicateClient({
				apiBaseUrl: env.REPLICATE_API_BASE_URL,
				apiToken: replicateApiToken,
			})
		: undefined,
	runpod: runpodService ? createRunpodClient(runpodService) : undefined,
});

const service = new ExecutionService(
	createDrizzleExecutionRepository(),
	createGeneratorExecutionQueueClient(redisUrl),
	inferenceClient,
	storageAdapter,
	console,
	eventPublisher
);

const worker = createGeneratorExecutionWorker({
	handler: async (job) => {
		if (job.name === "submit") {
			await service.processExecutionSubmitJob(job.data);
			return;
		}
		await service.processExecutionSyncJob(job.data);
	},
	async onJobExhausted(executionId, error) {
		await service.markExecutionFailed(
			executionId,
			`Queue job failed after retries: ${error.message}`
		);
	},
	redisUrl,
});

service
	.resumeActiveExecutionStreams()
	.then((count) => {
		if (count > 0) {
			console.info("generator.worker.streams-resumed", { count });
		}
	})
	.catch((error) => {
		console.error("generator.worker.streams-resume.failed", {
			message: error instanceof Error ? error.message : "unknown",
		});
	});

await new Promise<void>((resolve) => {
	let isShuttingDown = false;

	const shutdown = async () => {
		if (isShuttingDown) {
			return;
		}

		isShuttingDown = true;
		await worker.close();
		await eventPublisher?.close();
		resolve();
	};

	process.on("SIGTERM", () => {
		shutdown().catch((error) => {
			console.error("generator.worker.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	});
	process.on("SIGINT", () => {
		shutdown().catch((error) => {
			console.error("generator.worker.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	});
});
