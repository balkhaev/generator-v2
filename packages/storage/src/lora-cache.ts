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
	contentType?: string;
	date: Date;
	host: string;
	method: "PUT" | "DELETE";
	pathname: string;
	region: string;
	secretAccessKey: string;
}) {
	const { dateStamp, timestamp } = formatAmzDate(input.date);
	const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
	const includeContentType =
		input.method === "PUT" && typeof input.contentType === "string";
	const signedHeaders = includeContentType
		? "content-type;host;x-amz-content-sha256;x-amz-date"
		: "host;x-amz-content-sha256;x-amz-date";
	const canonicalHeaders = [
		...(includeContentType ? [`content-type:${input.contentType}`] : []),
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

/**
 * Removes an object from S3 using SigV4. Used by persons-service to clean up
 * dataset photos when an operator rejects a generated reference variant or
 * when a successful LoRA training releases the per-photo dataset (the final
 * dataset zip is preserved on `person.datasetUrl` for retrains).
 */
export async function deleteObjectFromS3(
	key: string,
	config: S3StorageConfig
): Promise<{ deleted: boolean; key: string }> {
	const deleteUrl = buildS3ObjectUrl(config, key);
	// SigV4 requires the SHA-256 of the (empty) request body even for DELETE.
	const emptyBodySha256 = await sha256Hex(new Uint8Array(0));
	const signed = await buildS3Authorization({
		accessKeyId: config.accessKeyId,
		contentSha256: emptyBodySha256,
		date: new Date(),
		host: deleteUrl.host,
		method: "DELETE",
		pathname: deleteUrl.pathname,
		region: config.region,
		secretAccessKey: config.secretAccessKey,
	});
	const response = await fetch(deleteUrl, {
		headers: {
			authorization: signed.authorization,
			"x-amz-content-sha256": emptyBodySha256,
			"x-amz-date": signed.timestamp,
		},
		method: "DELETE",
	});

	// S3 returns 204 No Content when the object is removed and 404 when it
	// never existed. Treat 404 as success because the desired end-state — the
	// object is not in the bucket — is already true.
	if (response.status === 404) {
		return { deleted: false, key };
	}
	if (!response.ok) {
		const responseBody = await response.text().catch(() => "");
		const detail = responseBody ? `: ${responseBody.slice(0, 500)}` : "";
		throw new Error(
			`S3 delete failed (${response.status} ${response.statusText}) for ${key}${detail}`
		);
	}

	return { deleted: true, key };
}

/**
 * Recovers the canonical S3 object key from a public URL produced by
 * {@link uploadObjectToS3}. Returns `null` when the URL doesn't belong to the
 * configured bucket so callers can short-circuit and skip the DELETE call
 * (and thus avoid leaking errors when working with externally-hosted assets
 * we never owned in the first place).
 */
export function extractS3KeyFromPublicUrl(
	publicUrl: string,
	config: S3StorageConfig
): string | null {
	const baseUrl = config.publicBaseUrl.replace(trailingSlashesPattern, "");
	if (!publicUrl.startsWith(`${baseUrl}/`)) {
		return null;
	}
	const rawKey = publicUrl.slice(baseUrl.length + 1);
	if (!rawKey) {
		return null;
	}

	try {
		return rawKey
			.split("/")
			.map((segment) => decodeURIComponent(segment))
			.join("/");
	} catch {
		return null;
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
