import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export interface OpenRouterModelOption {
	id: string;
	name: string;
}

export async function fetchOpenRouterModels(): Promise<
	OpenRouterModelOption[]
> {
	const payload = await requestJson<{ models?: OpenRouterModelOption[] }>(
		`${API_BASE_URL}/api/admin/openrouter-models`,
		{ credentials: "include" }
	);
	return Array.isArray(payload.models) ? payload.models : [];
}
