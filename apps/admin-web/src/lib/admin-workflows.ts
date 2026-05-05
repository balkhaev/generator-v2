import "server-only";

import type { AdminWorkflowListResponse } from "@generator/contracts/admin";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

export async function getAdminWorkflows(
	requestHeaders: Headers
): Promise<AdminWorkflowListResponse | null> {
	const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL;

	if (!serverBaseUrl) {
		return null;
	}

	try {
		return await requestJsonWithForwardedHeaders<AdminWorkflowListResponse>(
			`${normalizeBaseUrl(serverBaseUrl)}/api/admin/workflows`,
			requestHeaders,
			{ cache: "no-store" }
		);
	} catch {
		return null;
	}
}
