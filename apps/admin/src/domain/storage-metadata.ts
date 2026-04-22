import type {
	StorageCategorySummary,
	StorageObjectCategory,
	StorageObjectSummary,
} from "@generator/contracts/admin";
import type { S3ListedObject } from "@generator/storage";

export const STORAGE_CATEGORIES: StorageCategorySummary[] = [
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

export const DEFAULT_CLEANUP_PREFIXES = [
	"admin-uploads/",
	"datasets/",
	"generator-artifacts/",
	"loras/",
	"persons-inputs/",
	"studio-inputs/",
] as const;

export function inferStorageObjectCategory(key: string): StorageObjectCategory {
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

export function toStorageObjectSummary(
	object: S3ListedObject
): StorageObjectSummary {
	return {
		category: inferStorageObjectCategory(object.key),
		contentType: object.type,
		etag: object.etag,
		key: object.key,
		lastModified: object.lastModified?.toISOString() ?? null,
		sizeBytes: object.sizeBytes,
		url: object.url,
	};
}
