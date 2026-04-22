import { buildPublicAssetUrl, createS3Client } from "./client";
import type { S3StorageConfig } from "./config";

const DEFAULT_MAX_KEYS = 100;
const MAX_KEYS_LIMIT = 1000;

interface S3ListRequestOptions {
	maxKeys: number;
	prefix?: string;
	startAfter?: string;
}

interface S3PresignOptions {
	expiresIn: number;
	method: "GET" | "PUT";
	type?: string;
}

interface S3ManagementClient {
	list(options: S3ListRequestOptions | null): Promise<unknown>;
	presign(key: string, options?: S3PresignOptions): string;
	stat(key: string): Promise<unknown>;
}

export interface S3ListedObject {
	etag: string | null;
	key: string;
	lastModified: Date | null;
	sizeBytes: number;
	type: string | null;
	url: string;
}

export interface ListS3ObjectsInput {
	maxKeys?: number;
	prefix?: string;
	startAfter?: string;
}

export interface ListS3ObjectsResult {
	contents: S3ListedObject[];
	isTruncated: boolean;
	nextStartAfter: string | null;
	prefix: string;
	scannedCount: number;
	totalSizeBytes: number;
}

export interface S3ObjectStat {
	etag: string | null;
	key: string;
	lastModified: Date | null;
	sizeBytes: number;
	type: string | null;
	url: string;
}

function toManagementClient(client: Bun.S3Client): S3ManagementClient {
	return client as unknown as S3ManagementClient;
}

function clampMaxKeys(value: number | undefined): number {
	if (!(typeof value === "number" && Number.isFinite(value))) {
		return DEFAULT_MAX_KEYS;
	}
	return Math.min(Math.max(Math.trunc(value), 1), MAX_KEYS_LIMIT);
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readBoolean(value: unknown): boolean {
	return value === true;
}

function readDate(value: unknown): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === "string") {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}
	return null;
}

function normalizeListObject(
	value: unknown,
	config: S3StorageConfig
): S3ListedObject | null {
	const record = readRecord(value);
	if (!record) {
		return null;
	}
	const key = readString(record.key);
	if (!key) {
		return null;
	}
	return {
		etag: readString(record.etag),
		key,
		lastModified: readDate(record.lastModified),
		sizeBytes: readNumber(record.size),
		type: readString(record.type),
		url: buildPublicAssetUrl(config, key),
	};
}

function normalizeStatObject(
	key: string,
	value: unknown,
	config: S3StorageConfig
): S3ObjectStat {
	const record = readRecord(value) ?? {};
	return {
		etag: readString(record.etag),
		key,
		lastModified: readDate(record.lastModified),
		sizeBytes: readNumber(record.size),
		type: readString(record.type),
		url: buildPublicAssetUrl(config, key),
	};
}

export async function listS3Objects(
	input: ListS3ObjectsInput,
	config: S3StorageConfig,
	client: Bun.S3Client = createS3Client(config)
): Promise<ListS3ObjectsResult> {
	const prefix = input.prefix?.trim() ?? "";
	const options: S3ListRequestOptions = {
		maxKeys: clampMaxKeys(input.maxKeys),
	};
	if (prefix) {
		options.prefix = prefix;
	}
	if (input.startAfter?.trim()) {
		options.startAfter = input.startAfter.trim();
	}

	const result = await toManagementClient(client).list(options);
	const record = readRecord(result) ?? {};
	const rawContents = Array.isArray(record.contents) ? record.contents : [];
	const contents = rawContents
		.map((entry) => normalizeListObject(entry, config))
		.filter((entry): entry is S3ListedObject => entry !== null);
	const totalSizeBytes = contents.reduce(
		(total, object) => total + object.sizeBytes,
		0
	);
	const isTruncated = readBoolean(record.isTruncated);

	return {
		contents,
		isTruncated,
		nextStartAfter: isTruncated ? (contents.at(-1)?.key ?? null) : null,
		prefix,
		scannedCount: contents.length,
		totalSizeBytes,
	};
}

export async function statS3Object(
	key: string,
	config: S3StorageConfig,
	client: Bun.S3Client = createS3Client(config)
): Promise<S3ObjectStat> {
	const stat = await toManagementClient(client).stat(key);
	return normalizeStatObject(key, stat, config);
}

export function createPresignedGetUrl(
	input: { expiresInSeconds: number; key: string },
	config: S3StorageConfig,
	client: Bun.S3Client = createS3Client(config)
): string {
	return toManagementClient(client).presign(input.key, {
		expiresIn: input.expiresInSeconds,
		method: "GET",
	});
}
