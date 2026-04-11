import { normalizeS3RuntimeEnv } from "@generator/env/server";

import { CerebriumLoraTrainingRunner } from "@/providers/cerebrium-lora-training";
import { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";
import { createPersonLoraTrainingWorker } from "@/queue/person-lora-training";

const trailingSlashesPattern = /\/+$/u;

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const personsApiUrl = process.env.PERSONS_API_URL;
if (!personsApiUrl) {
	throw new Error("PERSONS_API_URL is required for the admin training worker");
}

const falKey = process.env.FAL_KEY;
const cerebriumApiKey = process.env.CEREBRIUM_API_KEY;
const cerebriumProjectId = process.env.CEREBRIUM_PROJECT_ID;

if (!(falKey || cerebriumApiKey)) {
	throw new Error(
		"At least one training provider is required: FAL_KEY or CEREBRIUM_API_KEY"
	);
}

const trainingControlToken =
	process.env.TRAINING_CONTROL_TOKEN ?? "local-training-control-token";

const s3Env = normalizeS3RuntimeEnv(process.env);
const s3Bucket = s3Env.S3_BUCKET?.trim();
const s3Endpoint = s3Env.S3_ENDPOINT;
const s3Config =
	s3Bucket && s3Endpoint
		? {
				bucket: s3Bucket,
				endpoint: s3Endpoint,
				accessKey: s3Env.S3_ACCESS_KEY_ID ?? "",
				secretKey: s3Env.S3_SECRET_ACCESS_KEY ?? "",
				region: s3Env.S3_REGION?.trim() ?? "us-east-1",
				publicUrl:
					s3Env.S3_PUBLIC_URL?.trim() ??
					`${s3Endpoint.replace(trailingSlashesPattern, "")}/${s3Bucket}`,
			}
		: undefined;

const trainingProvider =
	process.env.TRAINING_PROVIDER ?? (cerebriumApiKey ? "cerebrium" : "fal");

const falRunner = falKey
	? new FalZibLoraTrainingRunner({
			apiKey: falKey,
			personsApiBaseUrl: personsApiUrl,
			trainingControlToken,
			s3Config,
			logger: console,
		})
	: null;

const cerebriumRunner =
	cerebriumApiKey && cerebriumProjectId
		? new CerebriumLoraTrainingRunner({
				apiKey: cerebriumApiKey,
				projectId: cerebriumProjectId,
				region: process.env.CEREBRIUM_REGION,
				personsApiBaseUrl: personsApiUrl,
				trainingControlToken,
				falKey: falKey ?? undefined,
				s3Config,
				logger: console,
			})
		: null;

console.info(
	`admin.worker: ready (training provider: ${trainingProvider}, dataset upload: ${s3Config ? "S3" : "fal-storage"})`
);

createPersonLoraTrainingWorker({
	handler: async (job) => {
		console.info(
			`admin.worker: processing job ${job.data.personId} (${trainingProvider})`
		);
		if (trainingProvider === "cerebrium" && cerebriumRunner) {
			await cerebriumRunner.run(job.data);
		} else if (falRunner) {
			await falRunner.run(job.data);
		} else {
			throw new Error(
				`Training provider "${trainingProvider}" is not configured`
			);
		}
	},
	logger: console,
	redisUrl,
});

// biome-ignore lint/suspicious/noEmptyBlockStatements: keep-alive
await new Promise(() => {});
