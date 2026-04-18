import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import type { CredentialAvailability } from "@generator/runtime-config/domains";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function listIntegrationCredentials(): Promise<{
	credentials: CredentialAvailability[];
}> {
	return await requestJson(
		`${API_BASE_URL}/api/admin/integrations/credentials`,
		{
			credentials: "include",
		}
	);
}

export async function setIntegrationCredential(input: {
	keyName: string;
	provider: string;
	value: string;
}): Promise<void> {
	await requestJson(
		`${API_BASE_URL}/api/admin/integrations/credentials/${encodeURIComponent(input.provider)}/${encodeURIComponent(input.keyName)}`,
		{
			body: JSON.stringify({ value: input.value }),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "PUT",
		}
	);
}

export async function deleteIntegrationCredential(input: {
	keyName: string;
	provider: string;
}): Promise<void> {
	await requestJson(
		`${API_BASE_URL}/api/admin/integrations/credentials/${encodeURIComponent(input.provider)}/${encodeURIComponent(input.keyName)}`,
		{
			credentials: "include",
			method: "DELETE",
		}
	);
}
