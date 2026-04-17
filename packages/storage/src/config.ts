import { getS3StorageEnv } from "@generator/env/server";

const trailingSlashesPattern = /\/+$/u;

export interface S3StorageConfig {
	accessKeyId: string;
	bucket: string;
	endpoint: string;
	publicBaseUrl: string;
	region: string;
	secretAccessKey: string;
}

export function buildPublicBaseUrl(input: {
	bucket: string;
	endpoint: string;
	publicBaseUrl?: string | null;
}): string {
	const explicit = input.publicBaseUrl?.trim();
	if (explicit) {
		return explicit.replace(trailingSlashesPattern, "");
	}

	return `${input.endpoint.replace(trailingSlashesPattern, "")}/${input.bucket}`;
}

/**
 * Resolves a fully-validated S3 storage config from runtime env.
 * Throws when any of the required vars (S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY) are missing — the assumption is that S3 is mandatory
 * everywhere assets are produced or consumed.
 */
export function resolveS3StorageConfig(
	runtimeEnv: Record<string, string | undefined> = process.env
): S3StorageConfig {
	const env = getS3StorageEnv(runtimeEnv);
	const publicBaseUrl = buildPublicBaseUrl({
		bucket: env.S3_BUCKET,
		endpoint: env.S3_ENDPOINT,
		publicBaseUrl: runtimeEnv.S3_PUBLIC_BASE_URL,
	});

	return {
		accessKeyId: env.S3_ACCESS_KEY_ID,
		bucket: env.S3_BUCKET,
		endpoint: env.S3_ENDPOINT,
		publicBaseUrl,
		region: env.S3_REGION,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY,
	};
}

export function tryResolveS3StorageConfig(
	runtimeEnv: Record<string, string | undefined> = process.env
): S3StorageConfig | null {
	try {
		return resolveS3StorageConfig(runtimeEnv);
	} catch {
		return null;
	}
}
