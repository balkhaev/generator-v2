import { env, getKafkaEventBusConfig } from "@generator/env/server";
import {
	createKafkaEventConsumer,
	createKafkaEventPublisher,
	eventTopics,
} from "@generator/events";
import { createRedisIdempotencyLock, withIdempotency } from "@generator/queue";
import { resolveS3StorageConfig } from "@generator/storage";

import { createPersonsApiClient } from "@/clients/persons-api";
import {
	createRedisTrainingProviderSettings,
	type TrainingProviderName,
} from "@/domain/training-provider-settings";
import { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";
import { RunpodAiToolkitLoraTrainingRunner } from "@/providers/runpod-ai-toolkit-lora-training";
import type { PersonLoraTrainingJobData } from "@/queue/person-lora-training";
import { createPersonLoraTrainingWorker } from "@/queue/person-lora-training";
import { recoverInterruptedTrainings } from "@/recovery/training-recovery";

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
 * Экспериментальный RunPod ai-toolkit runner. Создаём всегда, когда есть
 * креды, чтобы UI-свитчер из admin-web мог переключать провайдер в runtime
 * без рестарта воркера. Если кредов нет — runner не будет создан и любая
 * попытка переключиться через UI отвергнется на стороне API.
 */
const runpodApiKey = env.RUNPOD_API_KEY;
const runpodEndpointId = env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID;
const runpodRunner =
	runpodApiKey && runpodEndpointId
		? new RunpodAiToolkitLoraTrainingRunner({
				apiBaseUrl: env.RUNPOD_API_BASE_URL,
				apiKey: runpodApiKey,
				baseModel: env.RUNPOD_AI_TOOLKIT_BASE_MODEL,
				endpointId: runpodEndpointId,
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

const trainingProviderSettings = createRedisTrainingProviderSettings({
	defaultProvider: defaultTrainingProvider,
	redisUrl,
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
	`admin.worker: ready (default training provider: ${defaultTrainingProvider}, runpod ${runpodRunner ? "enabled" : "disabled"}, dataset upload: S3)`
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
