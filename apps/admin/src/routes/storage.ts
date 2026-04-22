import type {
	StorageCategorySummary,
	StorageConfigSnapshot,
	StorageHealthSnapshot,
	StorageListObjectsResponse,
	StorageObjectCategory,
	StorageObjectSummary,
	StorageOverviewSnapshot,
	StoragePresignUploadInput,
	StoragePresignUploadResponse,
	StorageUploadResponse,
} from "@generator/contracts/admin";
import {
	buildPublicAssetUrl,
	createPresignedPutUrl,
	deleteObjectFromS3,
	listS3Objects,
	type S3ListedObject,
	type S3StorageConfig,
	uploadObjectToS3,
} from "@generator/storage";
import { Hono } from "hono";
import { toErrorResponse } from "@/routes/utils";

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;
const DEFAULT_PRESIGN_EXPIRES_SECONDS = 60 * 60;
const MAX_PRESIGN_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_UPLOAD_CONTENT_TYPE = "application/octet-stream";
const leadingSlashesPattern = /^\/+/u;
const backslashPattern = /\\/u;

const STORAGE_CATEGORIES: StorageCategorySummary[] = [
	{
		description: "Everything in the configured bucket",
		id: "all",
		label: "All",
		prefix: "",
	},
	{
		description: "Persisted generator outputs",
		id: "run-outputs",
		label: "Run outputs",
		prefix: "generator-artifacts/",
	},
	{
		description: "Studio prompt inputs",
		id: "studio-inputs",
		label: "Studio inputs",
		prefix: "studio-inputs/",
	},
	{
		description: "Persons reference inputs",
		id: "persons-inputs",
		label: "Persons inputs",
		prefix: "persons-inputs/",
	},
	{
		description: "LoRA training datasets",
		id: "datasets",
		label: "Datasets",
		prefix: "datasets/",
	},
	{
		description: "Imported and trained LoRA weights",
		id: "loras",
		label: "LoRAs",
		prefix: "loras/",
	},
	{
		description: "RunPod pod training logs",
		id: "runpod-logs",
		label: "RunPod logs",
		prefix: "loras/runpod-pod/logs/",
	},
];

function createStorageConfigSnapshot(
	config: S3StorageConfig | undefined
): StorageConfigSnapshot {
	if (!config) {
		return {
			accessKeyConfigured: false,
			bucket: null,
			configured: false,
			endpoint: null,
			missing: [
				"S3_BUCKET",
				"S3_ENDPOINT",
				"S3_ACCESS_KEY_ID",
				"S3_SECRET_ACCESS_KEY",
			],
			publicBaseUrl: null,
			region: null,
			secretAccessKeyConfigured: false,
		};
	}

	return {
		accessKeyConfigured: config.accessKeyId.length > 0,
		bucket: config.bucket,
		configured: true,
		endpoint: config.endpoint,
		missing: [],
		publicBaseUrl: config.publicBaseUrl,
		region: config.region,
		secretAccessKeyConfigured: config.secretAccessKey.length > 0,
	};
}

function requireStorageConfig(
	config: S3StorageConfig | undefined
): S3StorageConfig {
	if (!config) {
		throw new Error(
			"S3 storage is not configured. Set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in admin-api env."
		);
	}
	return config;
}

function normalizeStorageKey(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("key is required");
	}
	const key = value.trim().replace(leadingSlashesPattern, "");
	if (!key) {
		throw new Error("key is required");
	}
	if (key.endsWith("/")) {
		throw new Error("key must point to an object, not a prefix");
	}
	if (backslashPattern.test(key)) {
		throw new Error("key must use forward slashes");
	}
	return key;
}

function parseLimit(value: string | undefined): number {
	if (!value) {
		return DEFAULT_LIST_LIMIT;
	}
	const parsed = Number(value);
	if (!(Number.isFinite(parsed) && parsed > 0)) {
		return DEFAULT_LIST_LIMIT;
	}
	return Math.min(Math.trunc(parsed), MAX_LIST_LIMIT);
}

function parseExpires(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!(Number.isFinite(parsed) && parsed > 0)) {
		return DEFAULT_PRESIGN_EXPIRES_SECONDS;
	}
	return Math.min(Math.trunc(parsed), MAX_PRESIGN_EXPIRES_SECONDS);
}

function inferCategory(key: string): StorageObjectCategory {
	if (key.startsWith("loras/runpod-pod/logs/")) {
		return "runpod-logs";
	}
	if (key.startsWith("generator-artifacts/")) {
		return "run-outputs";
	}
	if (key.startsWith("studio-inputs/")) {
		return "studio-inputs";
	}
	if (key.startsWith("persons-inputs/")) {
		return "persons-inputs";
	}
	if (key.startsWith("datasets/")) {
		return "datasets";
	}
	if (key.startsWith("loras/")) {
		return "loras";
	}
	return "unknown";
}

function toStorageObjectSummary(object: S3ListedObject): StorageObjectSummary {
	return {
		category: inferCategory(object.key),
		contentType: object.type,
		etag: object.etag,
		key: object.key,
		lastModified: object.lastModified?.toISOString() ?? null,
		sizeBytes: object.sizeBytes,
		url: object.url,
	};
}

function createOverview(
	config: S3StorageConfig | undefined
): StorageOverviewSnapshot {
	return {
		categories: STORAGE_CATEGORIES,
		checkedAt: new Date().toISOString(),
		config: createStorageConfigSnapshot(config),
	};
}

function readContentType(value: unknown): string {
	return typeof value === "string" && value.trim()
		? value.trim()
		: DEFAULT_UPLOAD_CONTENT_TYPE;
}

function readStringFormValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function createStorageRoutes(options: { s3Config?: S3StorageConfig }) {
	const app = new Hono();

	app.get("/", (c) => c.json(createOverview(options.s3Config)));

	app.get("/objects", async (c) => {
		try {
			const config = requireStorageConfig(options.s3Config);
			const prefix = c.req.query("prefix")?.trim() ?? "";
			const cursor = c.req.query("cursor")?.trim() || undefined;
			const listed = await listS3Objects(
				{
					...(cursor ? { startAfter: cursor } : {}),
					maxKeys: parseLimit(c.req.query("maxKeys")),
					prefix,
				},
				config
			);
			const body: StorageListObjectsResponse = {
				config: createStorageConfigSnapshot(config),
				cursor: cursor ?? null,
				isTruncated: listed.isTruncated,
				nextCursor: listed.nextStartAfter,
				objects: listed.contents.map(toStorageObjectSummary),
				prefix: listed.prefix,
				scannedCount: listed.scannedCount,
				totalSizeBytes: listed.totalSizeBytes,
			};
			return c.json(body);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/health-check", async (c) => {
		const startedAt = performance.now();
		const checkedAt = new Date().toISOString();
		try {
			const config = requireStorageConfig(options.s3Config);
			const listed = await listS3Objects({ maxKeys: 1 }, config);
			const body: StorageHealthSnapshot = {
				checkedAt,
				error: null,
				latencyMs: Math.round(performance.now() - startedAt),
				ok: true,
				sampleCount: listed.scannedCount,
			};
			return c.json(body);
		} catch (error) {
			const body: StorageHealthSnapshot = {
				checkedAt,
				error: error instanceof Error ? error.message : "Storage check failed",
				latencyMs: Math.round(performance.now() - startedAt),
				ok: false,
				sampleCount: 0,
			};
			return c.json(body, 200);
		}
	});

	app.post("/objects", async (c) => {
		try {
			const config = requireStorageConfig(options.s3Config);
			const payload = await c.req.formData();
			const upload = payload.get("file");
			if (!(upload instanceof File)) {
				throw new Error("file is required");
			}
			if (upload.size <= 0) {
				throw new Error("file is empty");
			}
			const key = normalizeStorageKey(readStringFormValue(payload.get("key")));
			const contentType = readContentType(
				readStringFormValue(payload.get("contentType")) || upload.type
			);
			const uploaded = await uploadObjectToS3(
				{
					contentType,
					data: new Uint8Array(await upload.arrayBuffer()),
					key,
					tmpPrefix: "admin-storage",
				},
				config
			);
			const body: StorageUploadResponse = {
				object: {
					category: inferCategory(uploaded.key),
					contentType,
					etag: null,
					key: uploaded.key,
					lastModified: new Date().toISOString(),
					sizeBytes: uploaded.sizeBytes,
					url: uploaded.url,
				},
			};
			return c.json(body, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/presign-upload", async (c) => {
		try {
			const config = requireStorageConfig(options.s3Config);
			const payload =
				(await c.req.json()) as Partial<StoragePresignUploadInput>;
			const key = normalizeStorageKey(payload.key);
			const contentType = readContentType(payload.contentType);
			const expiresInSeconds = parseExpires(payload.expiresInSeconds);
			const url = await createPresignedPutUrl(
				{
					contentType,
					expiresInSeconds,
					key,
				},
				config
			);
			const body: StoragePresignUploadResponse = {
				expiresInSeconds,
				key,
				method: "PUT",
				publicUrl: buildPublicAssetUrl(config, key),
				requiredHeaders: {
					"content-type": contentType,
				},
				url,
			};
			return c.json(body);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.delete("/objects", async (c) => {
		try {
			const config = requireStorageConfig(options.s3Config);
			const payload = (await c.req.json()) as { key?: unknown };
			const key = normalizeStorageKey(payload.key);
			const deleted = await deleteObjectFromS3(key, config);
			return c.json({ deleted });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	return app;
}
