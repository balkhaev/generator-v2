import type {
	PromptEnhanceProviderName,
	PromptEnhanceSettingsSnapshot,
} from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function updatePromptEnhanceProvider(
	provider: PromptEnhanceProviderName
): Promise<PromptEnhanceSettingsSnapshot> {
	return await requestJson<PromptEnhanceSettingsSnapshot>(
		`${API_BASE_URL}/api/admin/prompt-enhance-provider`,
		{
			body: JSON.stringify({ provider }),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "PUT",
		}
	);
}
