import "server-only";

import type { StorageOverviewSnapshot } from "@generator/contracts/admin";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

export async function getStorageOverview(
	requestHeaders: Headers
): Promise<StorageOverviewSnapshot | null> {
	const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL;

	if (!serverBaseUrl) {
		return null;
	}

	try {
		return await requestJsonWithForwardedHeaders<StorageOverviewSnapshot>(
			`${normalizeBaseUrl(serverBaseUrl)}/api/admin/storage`,
			requestHeaders,
			{ cache: "no-store" }
		);
	} catch {
		return null;
	}
}
