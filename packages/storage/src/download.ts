import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const referenceImageUrlExtensionPattern =
	/\.(png|jpe?g|webp|gif|avif|mp4|webm)/iu;

const imageContentTypeToExtensionMap = new Map<string, string>([
	["image/avif", ".avif"],
	["image/gif", ".gif"],
	["image/jpeg", ".jpg"],
	["image/jpg", ".jpg"],
	["image/png", ".png"],
	["image/webp", ".webp"],
	["video/mp4", ".mp4"],
	["video/webm", ".webm"],
]);

async function retry<T>(
	operation: () => Promise<T>,
	options: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
	const attempts = options.attempts ?? DEFAULT_RETRY_ATTEMPTS;
	const delayMs = options.delayMs ?? DEFAULT_RETRY_DELAY_MS;
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError =
				error instanceof Error ? error : new Error("Unknown operation failure");
			if (attempt < attempts) {
				await sleep(delayMs);
			}
		}
	}
	throw lastError ?? new Error("Operation failed");
}

export interface RemoteAsset {
	contentType: string;
	data: Uint8Array;
}

export interface DownloadRemoteAssetOptions {
	attempts?: number;
	delayMs?: number;
	fetchImpl?: (
		input: string | URL | Request,
		init?: RequestInit
	) => Promise<Response>;
	headers?:
		| ((url: string) => Record<string, string> | undefined)
		| Record<string, string>;
}

export function downloadRemoteAsset(
	url: string,
	options: DownloadRemoteAssetOptions = {}
): Promise<RemoteAsset> {
	const fetchImpl = options.fetchImpl ?? fetch;
	return retry(
		async () => {
			const headers =
				typeof options.headers === "function"
					? options.headers(url)
					: options.headers;
			const response = await fetchImpl(url, { headers });
			if (!response.ok) {
				throw new Error(
					`Failed to download asset (${response.status}): ${url}`
				);
			}
			return {
				contentType:
					response.headers.get("content-type") ?? "application/octet-stream",
				data: new Uint8Array(await response.arrayBuffer()),
			};
		},
		{ attempts: options.attempts, delayMs: options.delayMs }
	);
}

export interface InferImageFileExtensionInput {
	contentType?: null | string;
	fallback?: string;
	url: string;
}

export function inferImageFileExtension(
	input: InferImageFileExtensionInput
): string {
	const normalizedContentType = input.contentType
		?.split(";")[0]
		?.trim()
		.toLowerCase();
	const extensionFromContentType = normalizedContentType
		? imageContentTypeToExtensionMap.get(normalizedContentType)
		: undefined;
	if (extensionFromContentType) {
		return extensionFromContentType;
	}

	const extensionFromUrl = input.url.match(
		referenceImageUrlExtensionPattern
	)?.[0];
	if (extensionFromUrl) {
		const lower = extensionFromUrl.toLowerCase();
		return lower === ".jpeg" ? ".jpg" : lower;
	}

	return input.fallback ?? ".bin";
}

export async function downloadImageAsset(
	url: string,
	options: DownloadRemoteAssetOptions = {}
): Promise<{ data: Uint8Array; extension: string }> {
	const asset = await downloadRemoteAsset(url, options);
	return {
		data: asset.data,
		extension: inferImageFileExtension({
			contentType: asset.contentType,
			fallback: ".jpg",
			url,
		}),
	};
}
