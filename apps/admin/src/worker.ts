import {
	env,
	getKafkaEventBusConfig,
	normalizeS3RuntimeEnv,
} from "@generator/env/server";
import {
	createKafkaEventConsumer,
	createKafkaEventPublisher,
	eventTopics,
} from "@generator/events";

import { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";
import { createPersonLoraTrainingWorker } from "@/queue/person-lora-training";

const trailingSlashesPattern = /\/+$/u;

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

const s3Env = normalizeS3RuntimeEnv(process.env);
const s3Bucket = s3Env.S3_BUCKET?.trim();
const s3Endpoint = s3Env.S3_ENDPOINT;
const s3AccessKey = s3Env.S3_ACCESS_KEY_ID?.trim();
const s3SecretKey = s3Env.S3_SECRET_ACCESS_KEY?.trim();
const s3Config =
	s3Bucket && s3Endpoint && s3AccessKey && s3SecretKey
		? {
				bucket: s3Bucket,
				endpoint: s3Endpoint,
				accessKey: s3AccessKey,
				secretKey: s3SecretKey,
				region: s3Env.S3_REGION?.trim() ?? "us-east-1",
				publicUrl:
					s3Env.S3_PUBLIC_URL?.trim() ??
					`${s3Endpoint.replace(trailingSlashesPattern, "")}/${s3Bucket}`,
			}
		: undefined;

if (!s3Config) {
	throw new Error(
		"S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required for the admin training worker"
	);
}

if (!(personsApiUrl || eventPublisher)) {
	throw new Error(
		"PERSONS_API_URL or KAFKA_BROKERS is required for the admin training worker"
	);
}

const falRunner = new FalZibLoraTrainingRunner({
	apiKey: falKey,
	eventPublisher,
	personsApiBaseUrl: personsApiUrl,
	trainingControlToken,
	s3Config,
	logger: console,
});

console.info(
	"admin.worker: ready (training provider: fal, dataset upload: S3)"
);

const queueWorker = createPersonLoraTrainingWorker({
	handler: async (job) => {
		console.info(`admin.worker: processing job ${job.data.personId} (fal)`);
		await falRunner.run(job.data);
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
					console.info("admin.worker: processing kafka training request", {
						personId: event.data.personId,
						trainingRunId: event.data.trainingRunId,
					});
					await falRunner.run(event.data);
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
