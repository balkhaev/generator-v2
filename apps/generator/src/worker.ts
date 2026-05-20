import { env, getKafkaEventBusConfig } from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { createRedisConnection } from "@generator/queue";
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
import { startRunpodRegistryReloadWatcher } from "@/providers/runpod-registry-reload-watcher";
import { loadRunpodWorkflowsFromDb } from "@/providers/runpod-template-loader";
import { seedRunpodTemplatesFromEnv } from "@/providers/runpod-template-seed";
import {
	createPodReaper,
	createRedisActivePodRegistry,
	createRedisPodInputStore,
	createRedisStickyVolumeStore,
	createRedisWarmPodPool,
} from "@/providers/runpod-warm-pool";

const LTX23_POD_NAME_PREFIX = "ltx23";
const REAPER_INTERVAL_MS = 60_000;

import {
	createProviderArtifactDownloadOptions,
	createStorageAdapter,
} from "@/providers/storage";
import {
	createGeneratorExecutionQueueClient,
	createGeneratorExecutionWorker,
} from "@/queue/executions";
import { createDrizzleExecutionRepository } from "@/repositories/executions";

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

/**
 * One-shot seed: env → БД при пустой таблице, чтобы worker сразу видел
 * admin-managed template'ы без ручных миграций после rollout'а. На
 * последующих стартах сидер выходит без действий.
 */
await seedRunpodTemplatesFromEnv({ logger: console });

/**
 * Сначала пытаемся собрать RunPod workflows из admin-managed pod template'ов
 * в БД. Если таблица пуста — fallback на env-переменные (current behavior,
 * для deploy без сидов). Single preload на старте процесса.
 */
const runpodWorkflowsFromDb = await loadRunpodWorkflowsFromDb({
	logger: console,
});

const runpodWorkflows: AnyWorkflowDefinition[] =
	runpodWorkflowsFromDb.length > 0 ? runpodWorkflowsFromDb : [];

if (runpodWorkflows.length === 0) {
	if (runpodFooocusEndpointId) {
		runpodWorkflows.push(
			createFooocusSdxlWorkflow({ endpointId: runpodFooocusEndpointId })
		);
	}
	if (runpodLtx23TemplateId) {
		const ltx23NetworkVolumes = env.RUNPOD_LTX23_POD_NETWORK_VOLUMES;
		if (ltx23NetworkVolumes.length === 0) {
			throw new Error(
				"RUNPOD_LTX23_POD_NETWORK_VOLUMES is required when RUNPOD_LTX23_POD_TEMPLATE_ID is set"
			);
		}
		runpodWorkflows.push(
			createLtx23VideoWorkflow({
				pod: {
					cloudType: env.RUNPOD_LTX23_POD_CLOUD_TYPE,
					containerDiskInGb: env.RUNPOD_LTX23_POD_CONTAINER_DISK_GB,
					imageName: env.RUNPOD_LTX23_POD_IMAGE_NAME,
					keepAliveMs: env.RUNPOD_LTX23_POD_KEEP_ALIVE_MS,
					namePrefix: LTX23_POD_NAME_PREFIX,
					networkVolumes: ltx23NetworkVolumes.map((volume) => ({
						gpuTypeIds: volume.gpus,
						label: volume.label,
						networkVolumeId: volume.id,
					})),
					templateId: runpodLtx23TemplateId,
					timeoutMs: env.RUNPOD_LTX23_POD_TIMEOUT_MS,
					volumeInGb: env.RUNPOD_LTX23_POD_VOLUME_GB,
				},
			})
		);
	}
} else {
	console.info("generator.worker.runpod.workflows-loaded-from-db", {
		count: runpodWorkflows.length,
		ids: runpodWorkflows.map((w) => w.id),
	});
}

// Shared Redis connection for warm-pod pool + input-store. Separate from the
// BullMQ connection so its `maxRetriesPerRequest: null` policy doesn't bleed
// onto pool ops that need to fail fast on submit/getStatus paths.
const runpodRedis =
	runpodApiKey && runpodWorkflows.length > 0
		? createRedisConnection(redisUrl)
		: null;

const warmPool = runpodRedis ? createRedisWarmPodPool(runpodRedis) : null;
const activeRegistry = runpodRedis
	? createRedisActivePodRegistry(runpodRedis)
	: null;
const stickyStore = runpodRedis
	? createRedisStickyVolumeStore(runpodRedis)
	: null;
const runpodService =
	runpodApiKey && runpodWorkflows.length > 0 && runpodRedis && warmPool
		? createRunpodService({
				activeRegistry: activeRegistry ?? undefined,
				apiKey: runpodApiKey,
				civitaiApiKey,
				hfToken: env.HF_TOKEN ?? env.HUGGINGFACE_TOKEN,
				inputStore: createRedisPodInputStore(runpodRedis),
				logger: console,
				podsBaseUrl: env.RUNPOD_REST_API_BASE_URL,
				s3: s3Config,
				serverlessBaseUrl: env.RUNPOD_API_BASE_URL,
				stickyStore: stickyStore ?? undefined,
				warmPool,
				workflows: runpodWorkflows,
			})
		: null;

// Reaper protects: warm-pool entries + active registry (in-flight pods). Без
// активного registry он смотрел бы только в warm-pool, что обрезало бы
// защиту аж до safetyAgeMs — и убивало бы pods во время cold start'а или
// длинного inference'а. Registry — это явная гарантия "пока worker
// держит pod, reaper его не трогает".
const reaper =
	runpodService && warmPool && env.RUNPOD_LTX23_POD_KEEP_ALIVE_MS > 0
		? createPodReaper({
				activeRegistry: activeRegistry ?? undefined,
				api: runpodService.podsApi,
				intervalMs: REAPER_INTERVAL_MS,
				logger: console,
				namePrefixes: [LTX23_POD_NAME_PREFIX],
				// Active registry уже защищает pod пока worker помнит про него,
				// поэтому safetyAgeMs здесь — backstop на случай worker-crash'а
				// между api.create и registry.add. Запас должен быть > worst-case
				// cold start + inference, но без registry он был бы критичен.
				safetyAgeMs:
					env.RUNPOD_LTX23_POD_TIMEOUT_MS +
					env.RUNPOD_LTX23_POD_KEEP_ALIVE_MS +
					5 * 60 * 1000,
				warmPool,
			})
		: null;
if (reaper) {
	console.info("generator.worker.runpod-pod-reaper.enabled", {
		intervalMs: REAPER_INTERVAL_MS,
	});
}

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

/**
 * Hot-reload: подписываемся на тот же канал что и generator-api.
 * При admin mutation worker делает graceful SIGTERM → orchestrator
 * рестартит → новый процесс перечитывает admin-managed registry из БД.
 */
const runpodReloadWatcher = startRunpodRegistryReloadWatcher({
	logger: console,
	processLabel: "generator-worker",
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
		reaper?.stop();
		await worker.close();
		await runpodReloadWatcher?.close();
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
