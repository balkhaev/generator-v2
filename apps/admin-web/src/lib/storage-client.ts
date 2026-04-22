import type {
	StorageHealthSnapshot,
	StorageListObjectsQuery,
	StorageListObjectsResponse,
	StorageOrphanDeleteInput,
	StorageOrphanDeleteResponse,
	StorageOrphanScanInput,
	StorageOrphanScanResponse,
	StorageOverviewSnapshot,
	StoragePresignUploadInput,
	StoragePresignUploadResponse,
	StorageUploadResponse,
} from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

function buildObjectsQuery(input: StorageListObjectsQuery): string {
	const params = new URLSearchParams();
	if (input.prefix) {
		params.set("prefix", input.prefix);
	}
	if (input.cursor) {
		params.set("cursor", input.cursor);
	}
	if (input.maxKeys) {
		params.set("maxKeys", String(input.maxKeys));
	}
	const query = params.toString();
	return query ? `?${query}` : "";
}

export async function fetchStorageOverview(): Promise<StorageOverviewSnapshot> {
	return await requestJson<StorageOverviewSnapshot>(
		`${API_BASE_URL}/api/admin/storage`,
		{ credentials: "include" }
	);
}

export async function fetchStorageObjects(
	query: StorageListObjectsQuery
): Promise<StorageListObjectsResponse> {
	return await requestJson<StorageListObjectsResponse>(
		`${API_BASE_URL}/api/admin/storage/objects${buildObjectsQuery(query)}`,
		{ credentials: "include" }
	);
}

export async function checkStorageHealth(): Promise<StorageHealthSnapshot> {
	return await requestJson<StorageHealthSnapshot>(
		`${API_BASE_URL}/api/admin/storage/health-check`,
		{
			credentials: "include",
			method: "POST",
		}
	);
}

export async function scanStorageOrphans(
	input: StorageOrphanScanInput
): Promise<StorageOrphanScanResponse> {
	return await requestJson<StorageOrphanScanResponse>(
		`${API_BASE_URL}/api/admin/storage/orphans/scan`,
		{
			body: JSON.stringify(input),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}
	);
}

export async function deleteStorageOrphans(
	input: StorageOrphanDeleteInput
): Promise<StorageOrphanDeleteResponse> {
	return await requestJson<StorageOrphanDeleteResponse>(
		`${API_BASE_URL}/api/admin/storage/orphans/delete`,
		{
			body: JSON.stringify(input),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}
	);
}

export async function uploadStorageObject(input: {
	contentType?: string;
	file: File;
	key: string;
}): Promise<StorageUploadResponse> {
	const formData = new FormData();
	formData.set("file", input.file);
	formData.set("key", input.key);
	if (input.contentType) {
		formData.set("contentType", input.contentType);
	}

	return await requestJson<StorageUploadResponse>(
		`${API_BASE_URL}/api/admin/storage/objects`,
		{
			body: formData,
			credentials: "include",
			method: "POST",
		}
	);
}

export async function createStoragePresignedUpload(
	input: StoragePresignUploadInput
): Promise<StoragePresignUploadResponse> {
	return await requestJson<StoragePresignUploadResponse>(
		`${API_BASE_URL}/api/admin/storage/presign-upload`,
		{
			body: JSON.stringify(input),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}
	);
}

export async function deleteStorageObject(key: string): Promise<void> {
	await requestJson(`${API_BASE_URL}/api/admin/storage/objects`, {
		body: JSON.stringify({ key }),
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		method: "DELETE",
	});
}
