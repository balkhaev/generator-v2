import "server-only";

import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

import type { AdminSnapshot } from "./shared";

export async function getStudioSnapshotForRequest(
	baseUrl: string,
	requestHeaders: Headers
): Promise<AdminSnapshot> {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const snapshot = await requestJsonWithForwardedHeaders<
		Partial<AdminSnapshot>
	>(`${normalizedBaseUrl}/api/studio-snapshot`, requestHeaders);

	return {
		runs: snapshot.runs ?? [],
		scenarios: snapshot.scenarios ?? [],
		shots: snapshot.shots ?? [],
		source: snapshot.source ?? "server",
		warnings: snapshot.warnings ?? [],
		workflows: snapshot.workflows ?? [],
	};
}

export type { AdminSnapshot } from "./shared";
