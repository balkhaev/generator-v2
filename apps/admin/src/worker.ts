import { env, getKafkaEventBusConfig } from "@generator/env/server";
import {
	createKafkaEventConsumer,
	createKafkaEventPublisher,
	eventTopics,
} from "@generator/events";
import { createRedisIdempotencyLock, withIdempotency } from "@generator/queue";
import { resolveS3StorageConfig } from "@generator/storage";

import { createPersonsApiClient } from "@/clients/persons-api";
import { resolveTrainingProviderAvailability } from "@/domain/training-provider-availability";
import {
	createRedisTrainingProviderSettings,
	type TrainingProviderName,
} from "@/domain/training-provider-settings";
import {
	createRedisWorkerSettingsPublisher,
	startWorkerSettingsHeartbeat,
} from "@/domain/worker-settings-store";
import { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";
import { RunpodAiToolkitLoraTrainingRunner } from "@/providers/runpod-ai-toolkit-lora-training";
import { RunpodPodClient } from "@/providers/runpod-pod-client";
import { RunpodPodLoraTrainingRunner } from "@/providers/runpod-pod-lora-training";
import type { PersonLoraTrainingJobData } from "@/queue/person-lora-training";
import { createPersonLoraTrainingWorker } from "@/queue/person-lora-training";
import { recoverInterruptedTrainings } from "@/recovery/training-recovery";

const TRAILING_FILENAME_PATTERN = /[^/]*$/u;
const TRAINING_LOCK_TTL_SECONDS = 24 * 60 * 60;
const TRAINING_LOCK_PREFIX = "admin:person-lora-training";
/**
 * Recovery locks must outlive the worst-case fal training poll (90 min) so a
 * second replica that boots while another worker is still resuming the same
 * run does not fork the resume.
 */
const RECOVERY_LOCK_TTL_SECONDS = 95 * 60;
const RECOVERY_LOCK_PREFIX = "admin:training-recovery";

const redisUrl = env.REDIS_URL;
const personsApiUrl = env.PERSONS_API_URL;
const kafkaConfig = getKafkaEventBusConfig("admin-worker");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "admin-worker" })
	: null;

const falKey = env.FAL_KEY;

if (!falKey) {
	throw new Error("FAL_KEY is required for the admin training worker");
}

const trainingControlToken = env.TRAINING_CONTROL_TOKEN;

const s3Config = resolveS3StorageConfig();

if (!(personsApiUrl || eventPublisher)) {
	throw new Error(
		"PERSONS_API_URL or KAFKA_BROKERS is required for the admin training worker"
	);
}

const defaultTrainingProvider = env.TRAINING_PROVIDER;

const falRunner = new FalZibLoraTrainingRunner({
	apiKey: falKey,
	eventPublisher,
	logger: console,
	personsApiBaseUrl: personsApiUrl,
	s3Config,
	trainingControlToken,
});

/**
 * Экспериментальные RunPod runner-ы. Создаём всегда, когда есть креды, чтобы
 * UI-свитчер мог переключать провайдер в runtime без рестарта. Какой именно
 * runner используется (serverless vs pod) — определяется RUNPOD_TRAINING_MODE.
 *
 * - serverless: бьёт в наш custom RunPod Serverless endpoint (handler.py)
 * - pod (default): поднимает on-demand GPU pod из готового pytorch-образа,
 *   бутстрап ставит ostris/ai-toolkit и гоняет тренировку (см.
 *   tools/runpod-ai-toolkit/pod-bootstrap.sh).
 */
const runpodApiKey = env.RUNPOD_API_KEY;
const runpodMode = env.RUNPOD_TRAINING_MODE;

const runpodServerlessRunner =
	runpodApiKey && env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID
		? new RunpodAiToolkitLoraTrainingRunner({
				apiBaseUrl: env.RUNPOD_API_BASE_URL,
				apiKey: runpodApiKey,
				baseModel: env.RUNPOD_AI_TOOLKIT_BASE_MODEL,
				endpointId: env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID,
				eventPublisher,
				falApiKeyForDataset: falKey,
				logger: console,
				personsApiBaseUrl: personsApiUrl,
				pollMs: env.RUNPOD_AI_TOOLKIT_POLL_MS,
				s3Config,
				trainingControlToken,
				trainingTimeoutMs: env.RUNPOD_AI_TOOLKIT_TIMEOUT_MS,
			})
		: null;

const runpodPodRunner =
	runpodApiKey && env.RUNPOD_POD_BOOTSTRAP_URL && s3Config
		? new RunpodPodLoraTrainingRunner({
				baseModel: env.RUNPOD_AI_TOOLKIT_BASE_MODEL,
				bootstrapUrl: env.RUNPOD_POD_BOOTSTRAP_URL,
				cloudType: env.RUNPOD_POD_CLOUD_TYPE,
				containerDiskInGb: env.RUNPOD_POD_CONTAINER_DISK_GB,
				eventPublisher,
				falApiKeyForDataset: falKey,
				gpuTypeIds: env.RUNPOD_POD_GPU_TYPE_IDS.split(",")
					.map((id) => id.trim())
					.filter((id) => id.length > 0),
				hfToken: env.HF_TOKEN ?? env.HUGGINGFACE_TOKEN,
				imageName: env.RUNPOD_POD_IMAGE_NAME,
				logger: console,
				networkVolumeId: env.RUNPOD_POD_NETWORK_VOLUME_ID,
				personsApiBaseUrl: personsApiUrl,
				podClient: new RunpodPodClient({
					apiKey: runpodApiKey,
					baseUrl: env.RUNPOD_REST_API_BASE_URL,
				}),
				podRunnerUrl: deriveSiblingUrl(
					env.RUNPOD_POD_BOOTSTRAP_URL,
					"pod_runner.py"
				),
				pollMs: env.RUNPOD_AI_TOOLKIT_POLL_MS,
				s3Config,
				templateId: env.RUNPOD_POD_TEMPLATE_ID,
				trainingControlToken,
				trainingTimeoutMs: env.RUNPOD_AI_TOOLKIT_TIMEOUT_MS,
				volumeInGb: env.RUNPOD_POD_VOLUME_GB,
			})
		: null;

const runpodRunner =
	runpodMode === "pod" ? runpodPodRunner : runpodServerlessRunner;

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

const trainingProviderSettings = createRedisTrainingProviderSettings({
	defaultProvider: defaultTrainingProvider,
	redisUrl,
});

/**
 * Heartbeat: publish the worker's settings snapshot to Redis so the gateway
 * (which lacks training secrets) can render an accurate /api/admin/settings.
 * Without this, UI shows "not configured" because gateway env doesn't have
 * FAL_KEY/RUNPOD_API_KEY/RUNPOD_AI_TOOLKIT_ENDPOINT_ID.
 */
const workerSettingsPublisher = createRedisWorkerSettingsPublisher({
	redisUrl,
});
const stopHeartbeat = startWorkerSettingsHeartbeat({
	build: () => ({
		availability: resolveTrainingProviderAvailability(env),
		runpod: {
			baseModel: env.RUNPOD_AI_TOOLKIT_BASE_MODEL,
			bootstrapUrl: env.RUNPOD_POD_BOOTSTRAP_URL ?? null,
			endpointConfigured: Boolean(env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID),
			endpointId: env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID ?? null,
			mode: env.RUNPOD_TRAINING_MODE,
			podGpuTypeIds: env.RUNPOD_POD_GPU_TYPE_IDS.split(",")
				.map((id) => id.trim())
				.filter((id) => id.length > 0),
			podImageName: env.RUNPOD_POD_IMAGE_NAME,
			podTemplateId: env.RUNPOD_POD_TEMPLATE_ID ?? null,
			pollMs: env.RUNPOD_AI_TOOLKIT_POLL_MS,
			timeoutMs: env.RUNPOD_AI_TOOLKIT_TIMEOUT_MS,
		},
	}),
	logger: console,
	publisher: workerSettingsPublisher,
});

const selectActiveRunner = async () => {
	const requested = await trainingProviderSettings.getProvider();
	if (requested === "runpod") {
		if (runpodRunner) {
			return {
				provider: "runpod" as TrainingProviderName,
				runner: runpodRunner,
			};
		}
		console.warn(
			"admin.worker: TRAINING_PROVIDER=runpod requested but RunPod creds are missing, falling back to fal"
		);
	}
	return { provider: "fal" as TrainingProviderName, runner: falRunner };
};

const trainingLock = createRedisIdempotencyLock({
	keyPrefix: TRAINING_LOCK_PREFIX,
	redisUrl,
	ttlSeconds: TRAINING_LOCK_TTL_SECONDS,
});

const recoveryLock = createRedisIdempotencyLock({
	keyPrefix: RECOVERY_LOCK_PREFIX,
	redisUrl,
	ttlSeconds: RECOVERY_LOCK_TTL_SECONDS,
});

/**
 * Tracks training runs currently being processed by this worker so we can
 * release their idempotency locks during graceful shutdown. Without this, a
 * mid-poll SIGTERM (e.g. deploy) would leave the lock held for 24h, blocking
 * any retry until expiry — which is exactly the bug the recovery sweep also
 * addresses, but releasing here lets BullMQ retry kick in immediately on the
 * NEXT replica without waiting for the boot-time sweep.
 */
const activeTrainingRunIds = new Set<string>();

const runTrainingOnce = async (
	source: "bullmq" | "kafka",
	data: PersonLoraTrainingJobData
) => {
	const outcome = await withIdempotency(
		trainingLock,
		data.trainingRunId,
		async () => {
			activeTrainingRunIds.add(data.trainingRunId);
			const selected = await selectActiveRunner();
			console.info("admin.worker: starting training", {
				personId: data.personId,
				provider: selected.provider,
				source,
				trainingRunId: data.trainingRunId,
			});
			try {
				await selected.runner.run(data);
			} finally {
				activeTrainingRunIds.delete(data.trainingRunId);
			}
		}
	);

	if (!outcome.acquired) {
		console.info("admin.worker: skipped duplicate training request", {
			personId: data.personId,
			source,
			trainingRunId: data.trainingRunId,
		});
	}
};

console.info(
	`admin.worker: ready (default training provider: ${defaultTrainingProvider}, runpod ${runpodRunner ? `enabled (mode=${runpodMode})` : "disabled"}, dataset upload: S3)`
);

const queueWorker = createPersonLoraTrainingWorker({
	handler: async (job) => {
		await runTrainingOnce("bullmq", job.data);
	},
	logger: console,
	redisUrl,
});

const eventConsumer = kafkaConfig
	? await createKafkaEventConsumer({
			config: kafkaConfig,
			groupId: "admin-worker",
			handlers: {
				onPersonLoraTrainingRequested: async (event) => {
					await runTrainingOnce("kafka", event.data);
				},
			},
			logger: console,
			topics: [eventTopics.personLoraTrainingRequests],
		})
	: null;

if (personsApiUrl) {
	const personsApiClient = createPersonsApiClient({
		baseUrl: personsApiUrl,
		bearerToken: trainingControlToken,
	});

	recoverInterruptedTrainings({
		client: personsApiClient,
		logger: console,
		recoveryLock,
		runner: falRunner,
		runpodPodRunner,
	}).catch((error: unknown) => {
		console.error("admin.recovery.boot-sweep-failed", {
			message: error instanceof Error ? error.message : "unknown",
		});
	});
} else {
	console.info("admin.worker: PERSONS_API_URL is not set, recovery disabled");
}

await new Promise<void>((resolve) => {
	let isShuttingDown = false;

	const shutdown = async () => {
		if (isShuttingDown) {
			return;
		}

		isShuttingDown = true;
		await queueWorker.close();
		await eventConsumer?.close();
		await eventPublisher?.close();
		const releaseSnapshot = Array.from(activeTrainingRunIds);
		await Promise.all(
			releaseSnapshot.map((trainingRunId) =>
				trainingLock.release(trainingRunId).catch((error: unknown) => {
					console.warn("admin.worker.shutdown.release-failed", {
						message: error instanceof Error ? error.message : "unknown",
						trainingRunId,
					});
				})
			)
		);
		await trainingLock.close();
		await recoveryLock.close();
		await trainingProviderSettings.close();
		stopHeartbeat();
		await workerSettingsPublisher.close();
		resolve();
	};

	process.on("SIGTERM", () => {
		shutdown().catch((error) => {
			console.error("admin.worker.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	});
	process.on("SIGINT", () => {
		shutdown().catch((error) => {
			console.error("admin.worker.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	});
});
