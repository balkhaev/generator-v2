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

const serverSchema = {
	DATABASE_URL: z.string().min(1),
	BETTER_AUTH_SECRET: z.string().min(32).optional(),
	BETTER_AUTH_URL: z.url().optional(),
	BETTER_AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
	CORS_ORIGIN: z.url().optional(),
	CORS_ORIGINS: z.string().min(1).optional(),
	GENERATOR_CALLBACK_TOKEN: z.string().min(1).optional(),
	GENERATOR_API_URL: z.url().optional(),
	STUDIO_API_URL: z.url().optional(),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	S3_BUCKET: z.string().min(1).optional(),
	S3_REGION: z.string().min(1).optional(),
	S3_ENDPOINT: z.url().optional(),
	S3_ACCESS_KEY_ID: z.string().min(1).optional(),
	S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
	FAL_KEY: z.string().min(1).optional(),
	CEREBRIUM_API_KEY: z.string().min(1).optional(),
	CEREBRIUM_PROJECT_ID: z.string().min(1).optional(),
	CEREBRIUM_REGION: z.string().min(1).optional(),
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
	return env.GENERATOR_CALLBACK_TOKEN ?? "local-generator-callback-token";
}

export function getStudioApiUrl() {
	return getRequiredEnvValue(env.STUDIO_API_URL, "STUDIO_API_URL");
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
