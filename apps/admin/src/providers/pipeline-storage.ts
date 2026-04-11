import { getS3StorageEnv } from "@generator/env/server";

const trailingSlashesPattern = /\/+$/u;
const leadingSlashesPattern = /^\/+/u;

type PipelineStorageObject = ArrayBuffer | Blob | Uint8Array | string;

function resolvePublicBaseUrl(config: ReturnType<typeof getS3StorageEnv>) {
	const explicitBaseUrl =
		process.env.ASSET_PUBLIC_BASE_URL?.trim() ||
		process.env.COMFY_INPUT_BASE_URL?.trim() ||
		process.env.S3_PUBLIC_BASE_URL?.trim();
	if (explicitBaseUrl) {
		return explicitBaseUrl;
	}

	return `${config.S3_ENDPOINT.replace(trailingSlashesPattern, "")}/${config.S3_BUCKET}`;
}

export function createPipelineStorage() {
	const config = getS3StorageEnv();
	const client = new globalThis.Bun.S3Client({
		accessKeyId: config.S3_ACCESS_KEY_ID,
		bucket: config.S3_BUCKET,
		endpoint: config.S3_ENDPOINT,
		region: config.S3_REGION,
		secretAccessKey: config.S3_SECRET_ACCESS_KEY,
	});
	const publicBaseUrl = resolvePublicBaseUrl(config);

	return {
		buildPublicUrl(key: string) {
			return new URL(
				key.replace(leadingSlashesPattern, ""),
				`${publicBaseUrl}/`
			).toString();
		},
		getBucket() {
			return config.S3_BUCKET;
		},
		getEndpoint() {
			return config.S3_ENDPOINT;
		},
		getRegion() {
			return config.S3_REGION;
		},
		getCredentials() {
			return {
				accessKeyId: config.S3_ACCESS_KEY_ID,
				secretAccessKey: config.S3_SECRET_ACCESS_KEY,
			};
		},
		async writeObject(key: string, body: PipelineStorageObject) {
			await client.write(key, body);
		},
	};
}
