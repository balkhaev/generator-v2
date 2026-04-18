import type {
	TrainingProviderName,
	TrainingProviderSettingsSnapshot,
} from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function fetchTrainingProvider(): Promise<TrainingProviderSettingsSnapshot> {
	return await requestJson<TrainingProviderSettingsSnapshot>(
		`${API_BASE_URL}/api/admin/training-provider`,
		{ credentials: "include" }
	);
}

export async function updateTrainingProvider(
	provider: TrainingProviderName
): Promise<TrainingProviderSettingsSnapshot> {
	return await requestJson<TrainingProviderSettingsSnapshot>(
		`${API_BASE_URL}/api/admin/training-provider`,
		{
			body: JSON.stringify({ provider }),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "PUT",
		}
	);
}
