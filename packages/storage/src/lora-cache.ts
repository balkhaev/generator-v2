import type { S3StorageConfig } from "./config";
import type { DownloadRemoteAssetOptions } from "./download";
import { downloadRemoteAsset } from "./download";

const trailingSlashesPattern = /\/+$/u;
const leadingSlashesPattern = /^\/+/u;

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
	const data =
		typeof input === "string" ? new TextEncoder().encode(input) : input;
	return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function hmacSha256(
	key: ArrayBuffer | Uint8Array,
	message: string
): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ hash: "SHA-256", name: "HMAC" },
		false,
		["sign"]
	);
	return crypto.subtle.sign(
		"HMAC",
		cryptoKey,
		new TextEncoder().encode(message)
	);
}

function formatAmzDate(date: Date): { dateStamp: string; timestamp: string } {
	const iso = date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
	return {
		dateStamp: iso.slice(0, 8),
		timestamp: iso,
	};
}

function buildS3ObjectUrl(config: S3StorageConfig, key: string): URL {
	const base = `${config.endpoint.replace(trailingSlashesPattern, "")}/`;
	const encodedKey = key
		.replace(leadingSlashesPattern, "")
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return new URL(`${encodeURIComponent(config.bucket)}/${encodedKey}`, base);
}

async function buildS3Authorization(input: {
	accessKeyId: string;
	contentSha256: string;
	contentType: string;
	date: Date;
	host: string;
	method: "PUT";
	pathname: string;
	region: string;
	secretAccessKey: string;
}) {
	const { dateStamp, timestamp } = formatAmzDate(input.date);
	const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
	const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
	const canonicalHeaders = [
		`content-type:${input.contentType}`,
		`host:${input.host}`,
		`x-amz-content-sha256:${input.contentSha256}`,
		`x-amz-date:${timestamp}`,
		"",
	].join("\n");
	const canonicalRequest = [
		input.method,
		input.pathname,
		"",
		canonicalHeaders,
		signedHeaders,
		input.contentSha256,
	].join("\n");
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		timestamp,
		credentialScope,
		await sha256Hex(canonicalRequest),
	].join("\n");
	const dateKey = await hmacSha256(
		new TextEncoder().encode(`AWS4${input.secretAccessKey}`),
		dateStamp
	);
	const dateRegionKey = await hmacSha256(dateKey, input.region);
	const dateRegionServiceKey = await hmacSha256(dateRegionKey, "s3");
	const signingKey = await hmacSha256(dateRegionServiceKey, "aws4_request");
	const signature = toHex(await hmacSha256(signingKey, stringToSign));

	return {
		authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		timestamp,
	};
}

/**
 * Uploads a blob to S3 without depending on system binaries or Bun's native S3
 * error reporting. This keeps runtime images slim and gives callers actionable
 * HTTP errors from the object storage provider.
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
	const uploadUrl = buildS3ObjectUrl(config, input.key);
	const contentSha256 = await sha256Hex(input.data);
	const signed = await buildS3Authorization({
		accessKeyId: config.accessKeyId,
		contentSha256,
		contentType: input.contentType,
		date: new Date(),
		host: uploadUrl.host,
		method: "PUT",
		pathname: uploadUrl.pathname,
		region: config.region,
		secretAccessKey: config.secretAccessKey,
	});
	const response = await fetch(uploadUrl, {
		body: input.data,
		headers: {
			authorization: signed.authorization,
			"content-type": input.contentType,
			"x-amz-content-sha256": contentSha256,
			"x-amz-date": signed.timestamp,
		},
		method: "PUT",
	});

	if (!response.ok) {
		const responseBody = await response.text().catch(() => "");
		const detail = responseBody ? `: ${responseBody.slice(0, 500)}` : "";
		throw new Error(
			`S3 upload failed (${response.status} ${response.statusText}) for ${input.key}${detail}`
		);
	}

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
