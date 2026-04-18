import type {
	CreateLoraFromUrlInput,
	ListLorasQuery,
	LoraRegistryEntry,
	LoraSourcePreview,
	PreviewLoraSourceInput,
	UpdateLoraInput,
} from "@generator/contracts/loras";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

function buildQueryString(query: ListLorasQuery): string {
	const params = new URLSearchParams();
	if (query.baseModel) {
		params.set("baseModel", query.baseModel);
	}
	if (query.status) {
		params.set("status", query.status);
	}
	const str = params.toString();
	return str ? `?${str}` : "";
}

export async function fetchAdminLoras(query: ListLorasQuery = {}) {
	const payload = await requestJson<{ loras: LoraRegistryEntry[] }>(
		`${API_BASE_URL}/api/admin/loras${buildQueryString(query)}`,
		{ credentials: "include" }
	);
	return payload.loras;
}

export async function createLoraFromUrl(input: CreateLoraFromUrlInput) {
	const payload = await requestJson<{
		lora?: LoraRegistryEntry;
		loras?: LoraRegistryEntry[];
	}>(`${API_BASE_URL}/api/admin/loras`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (payload.loras) {
		return payload.loras;
	}
	if (payload.lora) {
		return [payload.lora];
	}
	throw new Error("Server returned no LoRA records");
}

export async function previewLoraSource(input: PreviewLoraSourceInput) {
	const payload = await requestJson<{ preview: LoraSourcePreview }>(
		`${API_BASE_URL}/api/admin/loras/preview`,
		{
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}
	);
	return payload.preview;
}

export async function updateLora(id: string, patch: UpdateLoraInput) {
	const payload = await requestJson<{ lora: LoraRegistryEntry }>(
		`${API_BASE_URL}/api/admin/loras/${id}`,
		{
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		}
	);
	return payload.lora;
}

export async function archiveLora(id: string) {
	const payload = await requestJson<{ lora: LoraRegistryEntry }>(
		`${API_BASE_URL}/api/admin/loras/${id}/archive`,
		{ method: "POST", credentials: "include" }
	);
	return payload.lora;
}

export async function deleteLora(id: string) {
	const payload = await requestJson<{ lora: LoraRegistryEntry }>(
		`${API_BASE_URL}/api/admin/loras/${id}`,
		{ method: "DELETE", credentials: "include" }
	);
	return payload.lora;
}
