import "server-only";

import type { AdminSettingsSnapshot } from "@generator/contracts/admin";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

export type { AdminSettingsSnapshot } from "@generator/contracts/admin";

export async function getAdminSettingsSnapshot(
	requestHeaders: Headers
): Promise<AdminSettingsSnapshot | null> {
	const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL;

	if (!serverBaseUrl) {
		return null;
	}

	try {
		return await requestJsonWithForwardedHeaders<AdminSettingsSnapshot>(
			`${normalizeBaseUrl(serverBaseUrl)}/api/admin/settings`,
			requestHeaders,
			{ cache: "no-store" }
		);
	} catch {
		return null;
	}
}
