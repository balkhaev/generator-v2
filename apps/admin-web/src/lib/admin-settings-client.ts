import type { AdminSettingsSnapshot } from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function fetchAdminSettings(): Promise<AdminSettingsSnapshot> {
	return await requestJson<AdminSettingsSnapshot>(
		`${API_BASE_URL}/api/admin/settings`,
		{ credentials: "include" }
	);
}
