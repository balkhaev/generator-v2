import type { S3StorageConfig } from "./config";
import type { DownloadRemoteAssetOptions } from "./download";
import { downloadRemoteAsset } from "./download";

const trailingSlashesPattern = /\/+$/u;

/**
 * Streams an arbitrary blob to S3 via curl. Used for very large files (LoRA
 * weights, training datasets) where Bun's S3Client write APIs may buffer the
 * payload in memory longer than we want.
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
	const { writeFile, unlink } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { execSync } = await import("node:child_process");

	const tmpPath = join(tmpdir(), `${input.tmpPrefix}-${Date.now()}`);

	try {
		await writeFile(tmpPath, input.data);

		const uploadUrl = `${config.endpoint.replace(trailingSlashesPattern, "")}/${config.bucket}/${input.key}`;
		const cmd = [
			"curl",
			"-sf",
			"--max-time",
			"300",
			"-X",
			"PUT",
			"-H",
			`Content-Type: ${input.contentType}`,
			"--aws-sigv4",
			`aws:amz:${config.region}:s3`,
			"--user",
			`${config.accessKeyId}:${config.secretAccessKey}`,
			"-T",
			tmpPath,
			uploadUrl,
		]
			.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
			.join(" ");

		execSync(cmd, { timeout: 300_000 });
		return {
			key: input.key,
			sizeBytes: input.data.length,
			url: `${config.publicBaseUrl.replace(trailingSlashesPattern, "")}/${input.key}`,
		};
	} finally {
		unlink(tmpPath).catch(() => undefined);
	}
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
