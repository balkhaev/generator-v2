import type { S3StorageConfig } from "./config";

const trailingSlashesPattern = /\/+$/u;
const leadingSlashesPattern = /^\/+/u;
const hexEncodedPattern = /%[0-9A-F]{2}/g;

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

function rfc3986Encode(value: string): string {
	return encodeURIComponent(value).replace(hexEncodedPattern, (match) =>
		match.toLowerCase()
	);
}

function buildCanonicalUri(bucket: string, key: string): string {
	const segments = key
		.replace(leadingSlashesPattern, "")
		.split("/")
		.map((segment) => rfc3986Encode(segment));
	return `/${rfc3986Encode(bucket)}/${segments.join("/")}`;
}

function endpointHost(endpoint: string): string {
	return new URL(endpoint).host;
}

function endpointBaseUrl(endpoint: string): string {
	return endpoint.replace(trailingSlashesPattern, "");
}

interface PresignPutInput {
	contentType?: string;
	expiresInSeconds: number;
	key: string;
}

/**
 * Generates a SigV4-signed PUT URL for S3-compatible object storage. The URL is
 * safe to hand to an external worker (e.g. RunPod pod) so it can upload an
 * artifact directly to our bucket without ever seeing our long-lived
 * credentials.
 *
 * Important: the worker MUST send the request with method PUT and, if
 * `contentType` was provided, with a matching `content-type` header. Otherwise
 * the signature mismatches and S3 rejects the upload.
 */
export async function createPresignedPutUrl(
	input: PresignPutInput,
	config: S3StorageConfig
): Promise<string> {
	const { dateStamp, timestamp } = formatAmzDate(new Date());
	const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
	const credential = `${config.accessKeyId}/${credentialScope}`;
	const signedHeadersList = input.contentType
		? ["content-type", "host"]
		: ["host"];
	const signedHeaders = signedHeadersList.join(";");
	const host = endpointHost(config.endpoint);

	const queryParameters: [string, string][] = [
		["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
		["X-Amz-Credential", credential],
		["X-Amz-Date", timestamp],
		["X-Amz-Expires", String(input.expiresInSeconds)],
		["X-Amz-SignedHeaders", signedHeaders],
	];

	const canonicalQueryString = queryParameters
		.map(([name, value]) => `${rfc3986Encode(name)}=${rfc3986Encode(value)}`)
		.sort()
		.join("&");

	const canonicalHeaderLines = input.contentType
		? [`content-type:${input.contentType}`, `host:${host}`]
		: [`host:${host}`];
	const canonicalHeaders = `${canonicalHeaderLines.join("\n")}\n`;

	const canonicalUri = buildCanonicalUri(config.bucket, input.key);
	const canonicalRequest = [
		"PUT",
		canonicalUri,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		"UNSIGNED-PAYLOAD",
	].join("\n");

	const stringToSign = [
		"AWS4-HMAC-SHA256",
		timestamp,
		credentialScope,
		await sha256Hex(canonicalRequest),
	].join("\n");

	const dateKey = await hmacSha256(
		new TextEncoder().encode(`AWS4${config.secretAccessKey}`),
		dateStamp
	);
	const dateRegionKey = await hmacSha256(dateKey, config.region);
	const dateRegionServiceKey = await hmacSha256(dateRegionKey, "s3");
	const signingKey = await hmacSha256(dateRegionServiceKey, "aws4_request");
	const signature = toHex(await hmacSha256(signingKey, stringToSign));

	const baseUrl = endpointBaseUrl(config.endpoint);
	return `${baseUrl}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}
