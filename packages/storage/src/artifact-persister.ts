import {
	buildPublicAssetUrl,
	createS3Client,
	isOwnedAssetUrl,
	type S3ClientLike,
} from "./client";
import type { S3StorageConfig } from "./config";
import {
	type DownloadRemoteAssetOptions,
	downloadRemoteAsset,
	inferImageFileExtension,
} from "./download";

const dataUrlScheme = "data:";
const remoteAssetMaxBytes = 250 * 1024 * 1024;
const trailingSlashesPattern = /\/+$/u;

async function sha256Hex(input: string): Promise<string> {
	const buffer = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input)
	);
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export interface ArtifactPersister {
	isOwnedAssetUrl(url: string): boolean;
	/**
	 * Returns the URL unchanged when it's already a `data:` URL or already lives
	 * in our S3 bucket. Otherwise downloads the asset and uploads it under a
	 * deterministic key inside our bucket, returning the resulting public URL.
	 */
	persistArtifactUrl(input: {
		executionId: string;
		index?: number;
		url: string;
	}): Promise<string>;
	persistArtifactUrls(input: {
		executionId: string;
		urls: string[];
	}): Promise<string[]>;
}

export interface CreateArtifactPersisterOptions {
	client?: S3ClientLike;
	config: S3StorageConfig;
	downloadOptions?: DownloadRemoteAssetOptions;
	keyPrefix?: string;
	logger?: Pick<Console, "info" | "warn" | "error">;
}

export function createArtifactPersister(
	options: CreateArtifactPersisterOptions
): ArtifactPersister {
	const config = options.config;
	const client = options.client ?? createS3Client(config);
	const keyPrefix = (options.keyPrefix ?? "generator-artifacts").replace(
		trailingSlashesPattern,
		""
	);
	const logger = options.logger;

	function persistOwned(url: string): string {
		return url;
	}

	async function persistRemote(
		executionId: string,
		index: number,
		url: string
	): Promise<string> {
		const asset = await downloadRemoteAsset(url, options.downloadOptions);
		if (asset.data.byteLength > remoteAssetMaxBytes) {
			throw new Error(
				`Remote artifact exceeds max size (${remoteAssetMaxBytes} bytes): ${url}`
			);
		}

		const extension = inferImageFileExtension({
			contentType: asset.contentType,
			fallback: ".bin",
			url,
		});
		const fingerprint = (await sha256Hex(url)).slice(0, 24);
		const key = `${keyPrefix}/${executionId}/${index.toString().padStart(2, "0")}-${fingerprint}${extension}`;

		await client.write(key, asset.data, {
			type: asset.contentType,
		} as never);

		const publicUrl = buildPublicAssetUrl(config, key);
		logger?.info("storage.artifact.persisted", {
			executionId,
			key,
			source: url,
			sizeBytes: asset.data.byteLength,
			url: publicUrl,
		});
		return publicUrl;
	}

	return {
		isOwnedAssetUrl(url) {
			return isOwnedAssetUrl(config, url);
		},
		persistArtifactUrl({ executionId, index = 0, url }) {
			if (url.startsWith(dataUrlScheme)) {
				return Promise.resolve(url);
			}
			if (isOwnedAssetUrl(config, url)) {
				return Promise.resolve(persistOwned(url));
			}
			return persistRemote(executionId, index, url);
		},
		persistArtifactUrls({ executionId, urls }) {
			return Promise.all(
				urls.map((url, index) =>
					this.persistArtifactUrl({ executionId, index, url })
				)
			);
		},
	};
}
