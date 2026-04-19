import type { DatasetBuilderSettings } from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function updateDatasetBuilderModel(input: {
	model: string;
}): Promise<DatasetBuilderSettings> {
	return await requestJson<DatasetBuilderSettings>(
		`${API_BASE_URL}/api/admin/dataset-builder`,
		{
			body: JSON.stringify(input),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "PUT",
		}
	);
}
