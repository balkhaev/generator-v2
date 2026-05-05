import {
	type ArtifactPersister,
	createArtifactPersister,
	type DownloadRemoteAssetOptions,
	resolveS3StorageConfig,
	type S3StorageConfig,
} from "@generator/storage";

const dataUrlScheme = "data:";
const rootPath = "/";
const trailingSlashesPattern = /\/+$/u;
const replicateDeliveryHostnamePattern = /(^|\.)replicate\.delivery$/iu;

function isConfiguredStorageEndpointUrl(
	config: Pick<S3StorageConfig, "endpoint">,
	url: URL
): boolean {
	const endpoint = new URL(config.endpoint);
	if (url.origin !== endpoint.origin) {
		return false;
	}

	const endpointPath = endpoint.pathname.replace(trailingSlashesPattern, "");
	if (
		endpointPath &&
		url.pathname !== endpointPath &&
		!url.pathname.startsWith(`${endpointPath}/`)
	) {
		return false;
	}

	return url.pathname !== rootPath;
}

export interface StorageAdapter {
	/** Exposes the underlying persister for tests / migration tools. */
	readonly artifactPersister: ArtifactPersister;
	/**
	 * Validates an external input image URL. Accepts:
	 *   - `data:` URLs (inline previews / placeholders);
	 *   - URLs that already live in our owned S3 bucket;
	 *   - URLs from the same configured object-storage endpoint. Studio may pass
	 *     source assets from sibling buckets (for example Adorely gallery assets)
	 *     and those are still public, trusted object-storage URLs.
	 * Anything else is rejected so callers are forced to upload assets to trusted
	 * storage before passing them into the generator.
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
	downloadOptions?: DownloadRemoteAssetOptions;
	logger?: Pick<Console, "info" | "warn" | "error">;
}

export function createProviderArtifactDownloadOptions(options: {
	replicateApiToken?: null | string;
}): DownloadRemoteAssetOptions | undefined {
	const replicateApiToken = options.replicateApiToken?.trim();
	if (!replicateApiToken) {
		return undefined;
	}

	return {
		headers(url) {
			try {
				const { hostname } = new URL(url);
				if (replicateDeliveryHostnamePattern.test(hostname)) {
					return { authorization: `Bearer ${replicateApiToken}` };
				}
			} catch {
				return undefined;
			}
			return undefined;
		},
	};
}

export function createStorageAdapter(
	options: CreateStorageAdapterOptions = {}
): StorageAdapter {
	const config = options.config ?? resolveS3StorageConfig();
	const persister =
		options.artifactPersister ??
		createArtifactPersister({
			config,
			downloadOptions: options.downloadOptions,
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

			const normalizedUrl = parsed.toString();
			if (
				!(
					persister.isOwnedAssetUrl(normalizedUrl) ||
					isConfiguredStorageEndpointUrl(config, parsed)
				)
			) {
				throw new Error(
					`Input image URL must be hosted in trusted S3 storage (${config.publicBaseUrl} or ${config.endpoint}); ` +
						`got ${normalizedUrl}. Upload it via /api/input-assets first.`
				);
			}

			return normalizedUrl;
		},
		persistArtifactUrls(input) {
			return persister.persistArtifactUrls(input);
		},
	};
}
