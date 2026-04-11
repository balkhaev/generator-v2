import "server-only";

import type { AdminDashboardSnapshot } from "@generator/contracts/admin";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

export type {
	AdminDashboardSnapshot,
	DashboardRecentRun,
	DashboardScenarioSummary,
} from "@generator/contracts/admin";

function createEmptySnapshot(notice: string): AdminDashboardSnapshot {
	return {
		notices: [notice],
		recentRuns: [],
		runStatus: {
			failed: 0,
			queued: 0,
			running: 0,
			succeeded: 0,
		},
		scenarios: [],
		snapshotAt: new Date().toISOString(),
	};
}

export async function getAdminDashboardSnapshot(
	requestHeaders: Headers
): Promise<AdminDashboardSnapshot> {
	const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL;

	if (!serverBaseUrl) {
		return createEmptySnapshot(
			"NEXT_PUBLIC_SERVER_URL is not configured, so the admin gateway is unavailable."
		);
	}

	try {
		return await requestJsonWithForwardedHeaders<AdminDashboardSnapshot>(
			`${normalizeBaseUrl(serverBaseUrl)}/api/dashboard`,
			requestHeaders,
			{
				cache: "no-store",
			}
		);
	} catch {
		return createEmptySnapshot(
			"Unable to load the admin dashboard snapshot from the gateway."
		);
	}
}
