import "server-only";

import type { StudioRunDebugBundle } from "@generator/contracts/studio";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

export type { StudioRunDebugBundle } from "@generator/contracts/studio";

export function getAdminRunDebugBundle(
	runId: string,
	requestHeaders: Headers
): Promise<StudioRunDebugBundle> {
	const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL;
	if (!serverBaseUrl) {
		throw new Error("NEXT_PUBLIC_SERVER_URL is not configured.");
	}

	return requestJsonWithForwardedHeaders<StudioRunDebugBundle>(
		`${normalizeBaseUrl(serverBaseUrl)}/api/dashboard/runs/${encodeURIComponent(runId)}/debug`,
		requestHeaders,
		{ cache: "no-store" }
	);
}
