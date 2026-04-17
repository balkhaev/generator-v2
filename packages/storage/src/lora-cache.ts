import { createS3Client } from "./client";
import type { S3StorageConfig } from "./config";
import type { DownloadRemoteAssetOptions } from "./download";
import { downloadRemoteAsset } from "./download";

const trailingSlashesPattern = /\/+$/u;

/**
 * Uploads a blob to S3 without depending on a system curl binary. Runtime
 * images are intentionally slim, so this path must stay self-contained.
 */
export async function uploadObjectToS3(
	input: {
		contentType: string;
		data: Uint8Array;
		key: string;
		tmpPrefix: string;
	},
	config: S3StorageConfig
): Promise<{ key: string; sizeBytes: number; url: string }> {
	const client = createS3Client(config);
	await client.write(input.key, input.data, {
		type: input.contentType,
	} as never);

	return {
		key: input.key,
		sizeBytes: input.data.length,
		url: `${config.publicBaseUrl.replace(trailingSlashesPattern, "")}/${input.key}`,
	};
}

export async function uploadZipToS3(
	zipData: Uint8Array,
	filename: string,
	config: S3StorageConfig
): Promise<string> {
	const uploaded = await uploadObjectToS3(
		{
			contentType: "application/zip",
			data: zipData,
			key: `datasets/${filename}`,
			tmpPrefix: "fal-dataset",
		},
		config
	);
	return uploaded.url;
}

export async function cacheExternalLoraToS3(
	sourceUrl: string,
	config: S3StorageConfig,
	options: Pick<DownloadRemoteAssetOptions, "headers"> = {}
): Promise<{ key: string; sizeBytes: number; url: string }> {
	const hash = Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceUrl))
		)
	)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 16);
	const filename = `external-${hash}.safetensors`;
	const asset = await downloadRemoteAsset(sourceUrl, {
		headers: options.headers,
	});
	return uploadObjectToS3(
		{
			contentType: asset.contentType || "application/octet-stream",
			data: asset.data,
			key: `loras/external/${filename}`,
			tmpPrefix: "external-lora",
		},
		config
	);
}

export async function persistLoraWeightsToS3(
	input: { filename: string; sourceUrl: string },
	config: S3StorageConfig
) {
	const asset = await downloadRemoteAsset(input.sourceUrl);
	return uploadObjectToS3(
		{
			contentType: asset.contentType || "application/octet-stream",
			data: asset.data,
			key: `loras/${input.filename}`,
			tmpPrefix: "fal-lora",
		},
		config
	);
}
