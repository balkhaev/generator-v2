import { normalizeS3RuntimeEnv } from "@generator/env/server";

import { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";
import { createPersonLoraTrainingWorker } from "@/queue/person-lora-training";

const trailingSlashesPattern = /\/+$/u;

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const personsApiUrl = process.env.PERSONS_API_URL;
if (!personsApiUrl) {
	throw new Error("PERSONS_API_URL is required for the admin training worker");
}

const falKey = process.env.FAL_KEY;

if (!falKey) {
	throw new Error("FAL_KEY is required for the admin training worker");
}

const trainingControlToken =
	process.env.TRAINING_CONTROL_TOKEN ?? "local-training-control-token";

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

const falRunner = new FalZibLoraTrainingRunner({
	apiKey: falKey,
	personsApiBaseUrl: personsApiUrl,
	trainingControlToken,
	s3Config,
	logger: console,
});

console.info(
	"admin.worker: ready (training provider: fal, dataset upload: S3)"
);

createPersonLoraTrainingWorker({
	handler: async (job) => {
		console.info(`admin.worker: processing job ${job.data.personId} (fal)`);
		await falRunner.run(job.data);
	},
	logger: console,
	redisUrl,
});

// biome-ignore lint/suspicious/noEmptyBlockStatements: keep-alive
await new Promise(() => {});
