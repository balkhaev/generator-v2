import { env, getKafkaEventBusConfig } from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { resolveS3StorageConfig } from "@generator/storage";

import { ExecutionService } from "@/domain/executions";
import { createCivitaiClient } from "@/providers/civitai";
import { createFalClient } from "@/providers/fal";
import { createInferenceRouter } from "@/providers/inference-router";
import { createReplicateClient } from "@/providers/replicate";
import { createRunpodClient } from "@/providers/runpod";
import { createRunpodPodInferenceClient } from "@/providers/runpod-pod";
import {
	createProviderArtifactDownloadOptions,
	createStorageAdapter,
} from "@/providers/storage";
import {
	createGeneratorExecutionQueueClient,
	createGeneratorExecutionWorker,
} from "@/queue/executions";
import { createDrizzleExecutionRepository } from "@/repositories/executions";

const TRAILING_FILENAME_PATTERN = /[^/]*$/u;

function splitCsv(value: string): string[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function deriveSiblingUrl(baseUrl: string, siblingFilename: string): string {
	try {
		const url = new URL(baseUrl);
		const segments = url.pathname.split("/");
		segments[segments.length - 1] = siblingFilename;
		url.pathname = segments.join("/");
		return url.toString();
	} catch {
		return baseUrl.replace(TRAILING_FILENAME_PATTERN, siblingFilename);
	}
}

const redisUrl = env.REDIS_URL;
const civitaiApiKey = env.CIVITAI_API_KEY;
const falKey = env.FAL_KEY;
const replicateApiToken = env.REPLICATE_API_TOKEN;
const runpodApiKey = env.RUNPOD_API_KEY;
const runpodFooocusEndpointId = env.RUNPOD_FOOOCUS_ENDPOINT_ID;
const runpodLtx23PodBootstrapUrl = env.RUNPOD_LTX23_POD_BOOTSTRAP_URL;
const kafkaConfig = getKafkaEventBusConfig("generator-worker");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "generator-worker" })
	: null;

if (
	!(
		civitaiApiKey ||
		falKey ||
		replicateApiToken ||
		(runpodApiKey && runpodFooocusEndpointId) ||
		(runpodApiKey && runpodLtx23PodBootstrapUrl)
	)
) {
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
const runpodLtx23PodWorkflow = runpodLtx23PodBootstrapUrl
	? {
			bootstrapUrl: runpodLtx23PodBootstrapUrl,
			cloudType: env.RUNPOD_LTX23_POD_CLOUD_TYPE,
			containerDiskInGb: env.RUNPOD_LTX23_POD_CONTAINER_DISK_GB,
			gpuTypeIds: splitCsv(env.RUNPOD_LTX23_POD_GPU_TYPE_IDS),
			imageName: env.RUNPOD_LTX23_POD_IMAGE_NAME,
			namePrefix: "ltx23",
			networkVolumeId: env.RUNPOD_LTX23_POD_NETWORK_VOLUME_ID,
			podRunnerUrl: deriveSiblingUrl(
				runpodLtx23PodBootstrapUrl,
				"pod_runner.py"
			),
			templateId: env.RUNPOD_LTX23_POD_TEMPLATE_ID,
			timeoutMs: env.RUNPOD_LTX23_POD_TIMEOUT_MS,
			volumeInGb: env.RUNPOD_LTX23_POD_VOLUME_GB,
		}
	: undefined;

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
	runpod:
		runpodApiKey && runpodFooocusEndpointId
			? createRunpodClient({
					apiBaseUrl: env.RUNPOD_API_BASE_URL,
					apiKey: runpodApiKey,
					endpoints: {
						"fooocus-sdxl": runpodFooocusEndpointId,
					},
				})
			: undefined,
	runpodPod:
		runpodApiKey && runpodLtx23PodBootstrapUrl
			? createRunpodPodInferenceClient({
					apiKey: runpodApiKey,
					civitaiApiKey,
					hfToken: env.HF_TOKEN ?? env.HUGGINGFACE_TOKEN,
					restApiBaseUrl: env.RUNPOD_REST_API_BASE_URL,
					s3Config,
					workflows: {
						"ltx-2-3-video": runpodLtx23PodWorkflow,
						"ltx-2-3-synth-video": runpodLtx23PodWorkflow,
					},
				})
			: undefined,
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

// После старта переподключаем SSE-стримы для активных executions, чтобы не
// ждать polling'а после каждого рестарта worker'a (deploy/crash).
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
