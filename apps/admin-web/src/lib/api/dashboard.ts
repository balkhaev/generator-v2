import type { AdminDashboardSnapshot } from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function fetchAdminDashboard(): Promise<AdminDashboardSnapshot> {
	return await requestJson<AdminDashboardSnapshot>(
		`${API_BASE_URL}/api/dashboard`,
		{
			cache: "no-store",
			credentials: "include",
		}
	);
}
