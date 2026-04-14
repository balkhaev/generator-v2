import "server-only";

import type { AdminSetupStatus } from "@generator/contracts/admin";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

const defaultSetupStatus: AdminSetupStatus = {
	setupRequired: false,
};

export async function getAdminSetupStatus(
	requestHeaders: Headers
): Promise<AdminSetupStatus> {
	const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL;

	if (!serverBaseUrl) {
		return defaultSetupStatus;
	}

	try {
		return await requestJsonWithForwardedHeaders<AdminSetupStatus>(
			`${normalizeBaseUrl(serverBaseUrl)}/api/setup/status`,
			requestHeaders,
			{
				cache: "no-store",
			}
		);
	} catch {
		return defaultSetupStatus;
	}
}
