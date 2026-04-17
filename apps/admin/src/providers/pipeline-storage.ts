import {
	buildPublicAssetUrl,
	createS3Client,
	resolveS3StorageConfig,
} from "@generator/storage";

type PipelineStorageObject = ArrayBuffer | Blob | Uint8Array | string;

export function createPipelineStorage() {
	const config = resolveS3StorageConfig();
	const client = createS3Client(config);

	return {
		buildPublicUrl(key: string) {
			return buildPublicAssetUrl(config, key);
		},
		getBucket() {
			return config.bucket;
		},
		getEndpoint() {
			return config.endpoint;
		},
		getRegion() {
			return config.region;
		},
		getCredentials() {
			return {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			};
		},
		async writeObject(key: string, body: PipelineStorageObject) {
			await client.write(key, body);
		},
	};
}
