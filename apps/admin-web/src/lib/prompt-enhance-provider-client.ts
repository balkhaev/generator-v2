import type {
	PromptEnhanceProviderName,
	PromptEnhanceSettingsSnapshot,
	PromptEnhanceTarget,
} from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function updatePromptEnhanceProvider(input: {
	openRouterModel?: string;
	provider?: PromptEnhanceProviderName;
	target: PromptEnhanceTarget;
}): Promise<PromptEnhanceSettingsSnapshot> {
	const { target, ...payload } = input;
	return await requestJson<PromptEnhanceSettingsSnapshot>(
		`${API_BASE_URL}/api/admin/prompt-enhance-provider/${target}`,
		{
			body: JSON.stringify(payload),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "PUT",
		}
	);
}
