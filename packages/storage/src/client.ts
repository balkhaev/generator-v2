import type { S3StorageConfig } from "./config";

const leadingSlashesPattern = /^\/+/u;
const trailingSlashesPattern = /\/+$/u;

export type S3ClientLike = Pick<Bun.S3Client, "file" | "write">;

export function createS3Client(config: S3StorageConfig): Bun.S3Client {
	return new globalThis.Bun.S3Client({
		accessKeyId: config.accessKeyId,
		bucket: config.bucket,
		endpoint: config.endpoint,
		region: config.region,
		secretAccessKey: config.secretAccessKey,
	});
}

export function buildPublicAssetUrl(
	config: Pick<S3StorageConfig, "publicBaseUrl">,
	key: string
): string {
	return new URL(
		key.replace(leadingSlashesPattern, ""),
		`${config.publicBaseUrl}/`
	).toString();
}

export function isOwnedAssetUrl(
	config: Pick<S3StorageConfig, "publicBaseUrl">,
	url: string
): boolean {
	const base = `${config.publicBaseUrl.replace(trailingSlashesPattern, "")}/`;
	return url.startsWith(base);
}
