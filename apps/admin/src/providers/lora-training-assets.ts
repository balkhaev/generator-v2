import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const referenceImageUrlExtensionPattern = /\.(png|jpe?g|webp)/i;
const imageContentTypeToExtensionMap = new Map<string, string>([
	["image/jpeg", ".jpg"],
	["image/jpg", ".jpg"],
	["image/png", ".png"],
	["image/webp", ".webp"],
]);

export interface S3Config {
	accessKey: string;
	bucket: string;
	endpoint: string;
	publicUrl: string;
	region: string;
	secretKey: string;
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError =
				error instanceof Error ? error : new Error("Unknown operation failure");
			if (attempt < DEFAULT_RETRY_ATTEMPTS) {
				await sleep(DEFAULT_RETRY_DELAY_MS);
			}
		}
	}
	throw lastError ?? new Error("Operation failed");
}

export function inferImageFileExtension(input: {
	contentType?: null | string;
	fallback?: string;
	url: string;
}) {
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
		return extensionFromUrl.toLowerCase() === ".jpeg"
			? ".jpg"
			: extensionFromUrl.toLowerCase();
	}

	return input.fallback ?? ".jpg";
}

export function downloadImageAsset(url: string): Promise<{
	data: Uint8Array;
	extension: string;
}> {
	return retry(async () => {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download: ${response.status}`);
		}
		return {
			data: new Uint8Array(await response.arrayBuffer()),
			extension: inferImageFileExtension({
				contentType: response.headers.get("content-type"),
				url,
			}),
		};
	});
}

function crc32(data: Uint8Array): number {
	let crc = 0xff_ff_ff_ff;
	for (const byte of data) {
		// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
			crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
		}
	}
	// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
	return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

export function buildZipFromBuffers(
	files: Array<{ data: Uint8Array; name: string }>
): Uint8Array {
	const entries: Uint8Array[] = [];
	const centralDir: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const nameBytes = new TextEncoder().encode(file.name);
		const checksum = crc32(file.data);

		const localHeader = new Uint8Array(30 + nameBytes.length);
		const view = new DataView(localHeader.buffer);
		view.setUint32(0, 0x04_03_4b_50, true);
		view.setUint16(4, 20, true);
		view.setUint16(8, 0, true);
		view.setUint32(14, checksum, true);
		view.setUint32(18, file.data.length, true);
		view.setUint32(22, file.data.length, true);
		view.setUint16(26, nameBytes.length, true);
		localHeader.set(nameBytes, 30);

		const cdEntry = new Uint8Array(46 + nameBytes.length);
		const cdView = new DataView(cdEntry.buffer);
		cdView.setUint32(0, 0x02_01_4b_50, true);
		cdView.setUint16(4, 20, true);
		cdView.setUint16(6, 20, true);
		cdView.setUint16(12, 0, true);
		cdView.setUint32(16, checksum, true);
		cdView.setUint32(20, file.data.length, true);
		cdView.setUint32(24, file.data.length, true);
		cdView.setUint16(28, nameBytes.length, true);
		cdView.setUint32(42, offset, true);
		cdEntry.set(nameBytes, 46);

		entries.push(localHeader, file.data);
		centralDir.push(cdEntry);
		offset += localHeader.length + file.data.length;
	}

	const cdOffset = offset;
	let cdSize = 0;
	for (const entry of centralDir) {
		cdSize += entry.length;
	}

	const endRecord = new Uint8Array(22);
	const endView = new DataView(endRecord.buffer);
	endView.setUint32(0, 0x06_05_4b_50, true);
	endView.setUint16(8, files.length, true);
	endView.setUint16(10, files.length, true);
	endView.setUint32(12, cdSize, true);
	endView.setUint32(16, cdOffset, true);

	const totalSize = offset + cdSize + 22;
	const result = new Uint8Array(totalSize);
	let pos = 0;
	for (const part of [...entries, ...centralDir, endRecord]) {
		result.set(part, pos);
		pos += part.length;
	}
	return result;
}

async function downloadRemoteAsset(url: string): Promise<{
	contentType: string;
	data: Uint8Array;
}> {
	return await retry(async () => {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download asset: ${response.status}`);
		}
		return {
			contentType:
				response.headers.get("content-type") ?? "application/octet-stream",
			data: new Uint8Array(await response.arrayBuffer()),
		};
	});
}

async function uploadObjectToS3(
	input: {
		contentType: string;
		data: Uint8Array;
		key: string;
		tmpPrefix: string;
	},
	s3Config: S3Config
): Promise<{ key: string; sizeBytes: number; url: string }> {
	const { writeFile, unlink } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { execSync } = await import("node:child_process");

	const tmpPath = join(tmpdir(), `${input.tmpPrefix}-${Date.now()}`);

	try {
		await writeFile(tmpPath, input.data);

		const uploadUrl = `${s3Config.endpoint}/${s3Config.bucket}/${input.key}`;
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
			`aws:amz:${s3Config.region}:s3`,
			"--user",
			`${s3Config.accessKey}:${s3Config.secretKey}`,
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
			url: `${s3Config.publicUrl}/${input.key}`,
		};
	} finally {
		unlink(tmpPath).catch(() => undefined);
	}
}

export async function uploadZipToS3(
	zipData: Uint8Array,
	filename: string,
	s3Config: S3Config
): Promise<string> {
	const uploaded = await uploadObjectToS3(
		{
			contentType: "application/zip",
			data: zipData,
			key: `datasets/${filename}`,
			tmpPrefix: "fal-dataset",
		},
		s3Config
	);
	return uploaded.url;
}

export async function cacheExternalLoraToS3(
	sourceUrl: string,
	s3Config: S3Config
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
	const asset = await downloadRemoteAsset(sourceUrl);
	return uploadObjectToS3(
		{
			contentType: asset.contentType || "application/octet-stream",
			data: asset.data,
			key: `loras/external/${filename}`,
			tmpPrefix: "external-lora",
		},
		s3Config
	);
}

export async function persistLoraWeightsToS3(
	input: {
		filename: string;
		sourceUrl: string;
	},
	s3Config: S3Config
) {
	const asset = await downloadRemoteAsset(input.sourceUrl);
	return uploadObjectToS3(
		{
			contentType: asset.contentType || "application/octet-stream",
			data: asset.data,
			key: `loras/${input.filename}`,
			tmpPrefix: "fal-lora",
		},
		s3Config
	);
}
