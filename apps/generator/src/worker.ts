import { env, getKafkaEventBusConfig } from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { resolveS3StorageConfig } from "@generator/storage";

import { ExecutionService } from "@/domain/executions";
import { createFalClient } from "@/providers/fal";
import { createInferenceRouter } from "@/providers/inference-router";
import { createRunpodClient } from "@/providers/runpod";
import { createStorageAdapter } from "@/providers/storage";
import {
	createGeneratorExecutionQueueClient,
	createGeneratorExecutionWorker,
} from "@/queue/executions";
import { createDrizzleExecutionRepository } from "@/repositories/executions";

const redisUrl = env.REDIS_URL;
const falKey = env.FAL_KEY;
const runpodApiKey = env.RUNPOD_API_KEY;
const runpodFooocusEndpointId = env.RUNPOD_FOOOCUS_ENDPOINT_ID;
const kafkaConfig = getKafkaEventBusConfig("generator-worker");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "generator-worker" })
	: null;

if (!(falKey || (runpodApiKey && runpodFooocusEndpointId))) {
	throw new Error(
		"At least one inference provider is required for the generator worker"
	);
}

const s3Config = resolveS3StorageConfig();
const storageAdapter = createStorageAdapter({
	config: s3Config,
	logger: console,
});

const inferenceClient = createInferenceRouter({
	fal: falKey ? createFalClient({ apiKey: falKey }) : undefined,
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
