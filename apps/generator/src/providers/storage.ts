import {
	type ArtifactPersister,
	createArtifactPersister,
	resolveS3StorageConfig,
	type S3StorageConfig,
} from "@generator/storage";

const dataUrlScheme = "data:";

export interface StorageAdapter {
	/** Exposes the underlying persister for tests / migration tools. */
	readonly artifactPersister: ArtifactPersister;
	/**
	 * Validates an external input image URL. Accepts:
	 *   - `data:` URLs (inline previews / placeholders);
	 *   - URLs that already live in our owned S3 bucket
	 *     (i.e. `${publicBaseUrl}/...`).
	 * Anything else is rejected so callers are forced to upload assets to our
	 * S3 (`/api/input-assets` in studio, persons internal flows, etc.) before
	 * passing them into the generator.
	 */
	normalizeInputImageUrl(url: string): string;
	/**
	 * Persists every artifact URL to our S3, returning the list of canonical
	 * URLs in the same order. Already-owned URLs and `data:` URLs are returned
	 * unchanged. External `http(s)` URLs (e.g. `https://*.fal.media/...`) are
	 * downloaded and re-uploaded into `${publicBaseUrl}/<keyPrefix>/...`.
	 */
	persistArtifactUrls(input: {
		executionId: string;
		urls: string[];
	}): Promise<string[]>;
}

export interface CreateStorageAdapterOptions {
	artifactPersister?: ArtifactPersister;
	config?: S3StorageConfig;
	logger?: Pick<Console, "info" | "warn" | "error">;
}

export function createStorageAdapter(
	options: CreateStorageAdapterOptions = {}
): StorageAdapter {
	const config = options.config ?? resolveS3StorageConfig();
	const persister =
		options.artifactPersister ??
		createArtifactPersister({
			config,
			logger: options.logger,
		});

	return {
		artifactPersister: persister,
		normalizeInputImageUrl(url) {
			const trimmed = url.trim();
			if (!trimmed) {
				throw new Error("Input image URL is required");
			}
			if (trimmed.startsWith(dataUrlScheme)) {
				return trimmed;
			}

			let parsed: URL;
			try {
				parsed = new URL(trimmed);
			} catch {
				throw new Error(`Input image URL is not a valid URL: ${trimmed}`);
			}

			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
				throw new Error(
					`Input image URL must use http(s) or data: scheme, got ${parsed.protocol}`
				);
			}

			if (!persister.isOwnedAssetUrl(parsed.toString())) {
				throw new Error(
					`Input image URL must be hosted in our S3 (${config.publicBaseUrl}); ` +
						`got ${parsed.toString()}. Upload it via /api/input-assets first.`
				);
			}

			return parsed.toString();
		},
		persistArtifactUrls(input) {
			return persister.persistArtifactUrls(input);
		},
	};
}
