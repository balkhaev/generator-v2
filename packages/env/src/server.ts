import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function splitCsv(value: string | undefined) {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

const s3EndpointHasHttpSchemePattern = /^https?:\/\//iu;

/**
 * Normalizes runtime env aliases into a canonical shape:
 *   - Adds `https://` prefix to bare host `S3_ENDPOINT` values
 *   - Maps Hetzner-style `S3_ACCESS_KEY` / `S3_SECRET_KEY` aliases onto the
 *     canonical `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` names
 *   - Maps legacy `S3_PUBLIC_URL` / `ASSET_PUBLIC_BASE_URL` onto the canonical
 *     `S3_PUBLIC_BASE_URL`
 *   - Maps provider token aliases onto the canonical names used by services
 */
export function normalizeS3RuntimeEnv(
	runtimeEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = { ...runtimeEnv };

	const rawEndpoint = out.S3_ENDPOINT?.trim();
	if (rawEndpoint) {
		out.S3_ENDPOINT = s3EndpointHasHttpSchemePattern.test(rawEndpoint)
			? rawEndpoint
			: `https://${rawEndpoint}`;
	}

	const accessKeyId = out.S3_ACCESS_KEY_ID?.trim() || out.S3_ACCESS_KEY?.trim();
	if (accessKeyId) {
		out.S3_ACCESS_KEY_ID = accessKeyId;
	}

	const secretAccessKey =
		out.S3_SECRET_ACCESS_KEY?.trim() || out.S3_SECRET_KEY?.trim();
	if (secretAccessKey) {
		out.S3_SECRET_ACCESS_KEY = secretAccessKey;
	}

	const publicBaseUrl =
		out.S3_PUBLIC_BASE_URL?.trim() ||
		out.S3_PUBLIC_URL?.trim() ||
		out.ASSET_PUBLIC_BASE_URL?.trim();
	if (publicBaseUrl) {
		out.S3_PUBLIC_BASE_URL = publicBaseUrl;
	}

	const civitaiApiKey =
		out.CIVITAI_API_KEY?.trim() || out.CIVITAI_API_TOKEN?.trim();
	if (civitaiApiKey) {
		out.CIVITAI_API_KEY = civitaiApiKey;
	}

	const huggingFaceToken =
		out.HUGGINGFACE_TOKEN?.trim() || out.HF_TOKEN?.trim();
	if (huggingFaceToken) {
		out.HUGGINGFACE_TOKEN = huggingFaceToken;
	}

	return out;
}

const optionalUrlSchema = z.preprocess((value) => {
	if (typeof value !== "string") {
		return value;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}, z.url().optional());

const serverSchema = {
	// Core runtime
	// DATABASE_URL опциональна в схеме, чтобы сервисы, которым БД не нужна
	// (тесты с мок-репозиторием, MCP), могли импортировать env без валидационной
	// ошибки. Пакет @generator/db явно проверяет её в createDb().
	DATABASE_URL: z.string().min(1).optional(),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
	SKIP_AUTH: z
		.string()
		.optional()
		.transform((value) => value === "true"),

	// Event bus
	KAFKA_BROKERS: z.string().min(1).optional(),
	KAFKA_CLIENT_ID: z.string().min(1).default("generator"),
	KAFKA_SSL: z
		.string()
		.optional()
		.transform((value) => value === "true"),
	KAFKA_SASL_MECHANISM: z
		.enum(["plain", "scram-sha-256", "scram-sha-512"])
		.default("plain"),
	KAFKA_SASL_USERNAME: z.string().min(1).optional(),
	KAFKA_SASL_PASSWORD: z.string().min(1).optional(),

	// Auth
	BETTER_AUTH_SECRET: z.string().min(32).optional(),
	BETTER_AUTH_URL: z.url().optional(),
	BETTER_AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),

	// CORS
	CORS_ORIGIN: z.url().optional(),
	CORS_ORIGINS: z.string().min(1).optional(),

	// Cross-service API URLs
	ADMIN_API_URL: optionalUrlSchema,
	GENERATOR_API_URL: optionalUrlSchema,
	PERSONS_API_URL: optionalUrlSchema,
	STUDIO_API_URL: optionalUrlSchema,
	STUDIO_ADMIN_URL: optionalUrlSchema,
	PERSONS_ADMIN_URL: optionalUrlSchema,
	PERSONS_BASE_URL: optionalUrlSchema,
	PERSONS_OPERATOR_URL: optionalUrlSchema,

	// Internal tokens (defaults are dev-only, production must set real values)
	GENERATOR_CALLBACK_TOKEN: z
		.string()
		.min(1)
		.default("local-generator-callback-token"),
	GENERATOR_INTERNAL_TOKEN: z
		.string()
		.min(1)
		.default("local-generator-internal-token"),
	TRAINING_CONTROL_TOKEN: z
		.string()
		.min(1)
		.default("local-training-control-token"),

	// Provider credentials
	CIVITAI_API_KEY: z.string().min(1).optional(),
	CIVITAI_API_TOKEN: z.string().min(1).optional(),
	FAL_KEY: z.string().min(1).optional(),
	HF_TOKEN: z.string().min(1).optional(),
	HUGGINGFACE_TOKEN: z.string().min(1).optional(),
	XAI_API_KEY: z.string().min(1).optional(),

	// LoRA training provider selection.
	// "fal" — текущий fal-ai/z-image-trainer пайплайн.
	// "runpod" — экспериментальный ai-toolkit на RunPod serverless.
	TRAINING_PROVIDER: z.enum(["fal", "runpod"]).default("fal"),

	// RunPod (ai-toolkit) — экспериментально.
	// Mode "serverless" использует custom RunPod Serverless endpoint (нужно
	// деплоить свой handler). Mode "pod" поднимает on-demand GPU Pod из готового
	// pytorch-образа и гоняет ai-toolkit через bootstrap-скрипт.
	RUNPOD_API_KEY: z.string().min(1).optional(),
	RUNPOD_TRAINING_MODE: z.enum(["serverless", "pod"]).default("pod"),

	// Serverless-only.
	RUNPOD_AI_TOOLKIT_ENDPOINT_ID: z.string().min(1).optional(),
	RUNPOD_API_BASE_URL: z.url().default("https://api.runpod.ai/v2"),

	// Shared (применимо к обоим режимам).
	RUNPOD_AI_TOOLKIT_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(120 * 60 * 1000),
	RUNPOD_AI_TOOLKIT_POLL_MS: z.coerce.number().int().positive().default(30_000),
	RUNPOD_AI_TOOLKIT_BASE_MODEL: z
		.enum([
			"z-image",
			"flux-dev",
			"flux-schnell",
			"flux2-dev",
			"sdxl",
			"qwen-image",
		])
		.default("z-image"),

	// Pod-mode-only.
	RUNPOD_REST_API_BASE_URL: z.url().default("https://rest.runpod.io/v1"),
	RUNPOD_POD_IMAGE_NAME: z
		.string()
		.min(1)
		.default("runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"),
	RUNPOD_POD_GPU_TYPE_IDS: z
		.string()
		.min(1)
		.default("NVIDIA RTX A4000,NVIDIA GeForce RTX 4090,NVIDIA RTX A5000")
		.describe("Comma-separated list of acceptable RunPod GPU type ids."),
	RUNPOD_POD_CONTAINER_DISK_GB: z.coerce.number().int().positive().default(60),
	RUNPOD_POD_VOLUME_GB: z.coerce.number().int().positive().default(60),
	RUNPOD_POD_CLOUD_TYPE: z.enum(["SECURE", "COMMUNITY"]).default("SECURE"),
	RUNPOD_POD_BOOTSTRAP_URL: z
		.url()
		.optional()
		.describe(
			"Public URL of pod-bootstrap.sh executed inside the pod. Defaults to the script committed in tools/runpod-ai-toolkit on the main branch."
		),
	RUNPOD_POD_NETWORK_VOLUME_ID: z.string().min(1).optional(),

	// Public asset URLs (S3_PUBLIC_BASE_URL is canonical; S3_PUBLIC_URL and
	// ASSET_PUBLIC_BASE_URL are accepted as aliases via normalizeS3RuntimeEnv).
	S3_PUBLIC_BASE_URL: optionalUrlSchema,

	// S3 storage
	S3_BUCKET: z.string().min(1).optional(),
	S3_REGION: z.string().min(1).optional(),
	S3_ENDPOINT: z.url().optional(),
	S3_ACCESS_KEY_ID: z.string().min(1).optional(),
	S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

	// Persons workflow defaults
	PERSONS_DEFAULT_AVATAR_WORKFLOW: z
		.string()
		.min(1)
		.default("fal-zimage-turbo"),
	PERSONS_DEFAULT_LORA_WORKFLOW: z.string().min(1).default("fal-zimage-turbo"),
	PERSON_LORA_TRAINING_STEPS: z.coerce.number().int().positive().optional(),

	// Reconcile workers
	RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
	RECONCILE_WATCH: z
		.string()
		.default("true")
		.transform((value) => value !== "false"),

	// MCP debug server
	MCP_AUTH_TOKEN: z.string().min(1).optional(),
};

function createServerEnv(
	runtimeEnv: Record<string, string | undefined> = process.env
) {
	return createEnv({
		server: serverSchema,
		runtimeEnv: normalizeS3RuntimeEnv(runtimeEnv),
		emptyStringAsUndefined: true,
	});
}

type ServerEnv = ReturnType<typeof createServerEnv>;

let cachedEnv: ServerEnv | null = null;

function getServerEnv() {
	cachedEnv ??= createServerEnv();
	return cachedEnv;
}

export const env = new Proxy({} as ServerEnv, {
	get(_, property) {
		return getServerEnv()[property as keyof ServerEnv];
	},
});

function getRequiredEnvValue(value: string | undefined, name: string) {
	if (!value) {
		throw new Error(`${name} is required`);
	}

	return value;
}

export function getCorsOrigins() {
	const origins = [
		...splitCsv(env.CORS_ORIGINS),
		...(env.CORS_ORIGIN ? [env.CORS_ORIGIN] : []),
	];

	return [...new Set(origins)];
}

export function getRequiredCorsOrigins() {
	const origins = getCorsOrigins();

	if (origins.length === 0) {
		throw new Error("CORS_ORIGIN or CORS_ORIGINS is required");
	}

	return origins;
}

export function getAuthConfig() {
	const cookieDomain = env.BETTER_AUTH_COOKIE_DOMAIN?.trim();

	return {
		baseUrl: getRequiredEnvValue(env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
		cookieDomain: cookieDomain && cookieDomain.length > 0 ? cookieDomain : null,
		secret: getRequiredEnvValue(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
		trustedOrigins: getRequiredCorsOrigins(),
	};
}

export function getDatabaseUrl() {
	return getRequiredEnvValue(env.DATABASE_URL, "DATABASE_URL");
}

export function getGeneratorApiUrl() {
	return getRequiredEnvValue(env.GENERATOR_API_URL, "GENERATOR_API_URL");
}

export function getGeneratorCallbackToken() {
	return env.GENERATOR_CALLBACK_TOKEN;
}

export function getGeneratorInternalToken() {
	return env.GENERATOR_INTERNAL_TOKEN;
}

export function getStudioApiUrl() {
	return getRequiredEnvValue(env.STUDIO_API_URL, "STUDIO_API_URL");
}

export function getKafkaEventBusConfig(clientIdSuffix: string) {
	const brokers = splitCsv(env.KAFKA_BROKERS);

	if (brokers.length === 0) {
		return null;
	}

	const username = env.KAFKA_SASL_USERNAME?.trim();
	const password = env.KAFKA_SASL_PASSWORD?.trim();

	return {
		brokers,
		clientId: `${env.KAFKA_CLIENT_ID}-${clientIdSuffix}`,
		sasl:
			username && password
				? {
						mechanism: env.KAFKA_SASL_MECHANISM,
						password,
						username,
					}
				: undefined,
		ssl: env.KAFKA_SSL,
	};
}

const s3StorageEnvSchema = z.object({
	S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
	S3_REGION: z.string().min(1).default("hel1"),
	S3_ENDPOINT: z.url("S3_ENDPOINT is required"),
	S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
	S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
});

export type S3StorageEnv = z.infer<typeof s3StorageEnvSchema>;

export function getS3StorageEnv(
	runtimeEnv: Record<string, string | undefined> = process.env
) {
	return s3StorageEnvSchema.parse(normalizeS3RuntimeEnv(runtimeEnv));
}
