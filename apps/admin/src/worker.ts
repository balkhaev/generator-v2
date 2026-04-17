import { env, getKafkaEventBusConfig } from "@generator/env/server";
import {
	createKafkaEventConsumer,
	createKafkaEventPublisher,
	eventTopics,
} from "@generator/events";
import { createRedisIdempotencyLock, withIdempotency } from "@generator/queue";
import { resolveS3StorageConfig } from "@generator/storage";

import {
	createGrokVisionFaceJudge,
	FalZibLoraTrainingRunner,
} from "@/providers/fal-zib-lora-training";
import type { PersonLoraTrainingJobData } from "@/queue/person-lora-training";
import { createPersonLoraTrainingWorker } from "@/queue/person-lora-training";

const TRAINING_LOCK_TTL_SECONDS = 24 * 60 * 60;
const TRAINING_LOCK_PREFIX = "admin:person-lora-training";

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

const xaiApiKey = env.XAI_API_KEY;
const faceJudge = xaiApiKey
	? createGrokVisionFaceJudge({ apiKey: xaiApiKey })
	: null;

if (!faceJudge) {
	console.info(
		"admin.worker: identity gate disabled (XAI_API_KEY not set); LoRA dataset will be assembled without face-similarity verification"
	);
}

const falRunner = new FalZibLoraTrainingRunner({
	apiKey: falKey,
	eventPublisher,
	faceJudge,
	personsApiBaseUrl: personsApiUrl,
	trainingControlToken,
	s3Config,
	logger: console,
});

const trainingLock = createRedisIdempotencyLock({
	keyPrefix: TRAINING_LOCK_PREFIX,
	redisUrl,
	ttlSeconds: TRAINING_LOCK_TTL_SECONDS,
});

const runTrainingOnce = async (
	source: "bullmq" | "kafka",
	data: PersonLoraTrainingJobData
) => {
	const outcome = await withIdempotency(
		trainingLock,
		data.trainingRunId,
		async () => {
			console.info("admin.worker: starting training", {
				personId: data.personId,
				source,
				trainingRunId: data.trainingRunId,
			});
			await falRunner.run(data);
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
	"admin.worker: ready (training provider: fal, dataset upload: S3)"
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
		await trainingLock.close();
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
