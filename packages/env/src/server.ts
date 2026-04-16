import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const s3EndpointHasHttpSchemePattern = /^https?:\/\//iu;

/** Accepts Hetzner-style `S3_ACCESS_KEY` / `S3_SECRET_KEY` and bare host endpoints. */
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
	FAL_KEY: z.string().min(1).optional(),

	// Public asset URLs
	ASSET_PUBLIC_BASE_URL: optionalUrlSchema,
	COMFY_INPUT_BASE_URL: optionalUrlSchema,
	COMFY_OUTPUT_BASE_URL: optionalUrlSchema,
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
	PERSONS_DEFAULT_LORA_WORKFLOW: z
		.string()
		.min(1)
		.default("fal-zimage-turbo-lora"),
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

function parseCorsOrigins(rawOrigins: string | undefined) {
	if (!rawOrigins) {
		return [];
	}

	return rawOrigins
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
}

export function getCorsOrigins() {
	const origins = [
		...parseCorsOrigins(env.CORS_ORIGINS),
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

export function getGeneratorApiUrl() {
	return getRequiredEnvValue(env.GENERATOR_API_URL, "GENERATOR_API_URL");
}

export function getGeneratorCallbackToken() {
	return env.GENERATOR_CALLBACK_TOKEN;
}

export function getGeneratorInternalToken() {
	return env.GENERATOR_INTERNAL_TOKEN;
}

export function getTrainingControlToken() {
	return env.TRAINING_CONTROL_TOKEN;
}

export function getStudioApiUrl() {
	return getRequiredEnvValue(env.STUDIO_API_URL, "STUDIO_API_URL");
}

export function getAdminApiUrl() {
	return getRequiredEnvValue(
		env.ADMIN_API_URL ?? env.STUDIO_ADMIN_URL,
		"ADMIN_API_URL"
	);
}

/**
 * Базовый URL публичных ассетов; fallback на legacy-переменные сохранён для
 * плавной миграции. Возвращает undefined, если ни одна переменная не задана.
 */
export function getPublicAssetBaseUrl(): string | undefined {
	return (
		env.ASSET_PUBLIC_BASE_URL ??
		env.COMFY_INPUT_BASE_URL ??
		env.S3_PUBLIC_BASE_URL ??
		undefined
	);
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
