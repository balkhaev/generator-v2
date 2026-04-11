import "server-only";

import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

import type { AdminSnapshot } from "./shared";

export function getStudioSnapshotForRequest(
	baseUrl: string,
	requestHeaders: Headers
): Promise<AdminSnapshot> {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	return requestJsonWithForwardedHeaders<AdminSnapshot>(
		`${normalizedBaseUrl}/api/studio-snapshot`,
		requestHeaders
	);
}

export type { AdminSnapshot } from "./shared";
