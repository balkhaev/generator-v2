import "server-only";

import type { StudioRunDebugBundle } from "@generator/contracts/studio";
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

export function getStudioRunDebugBundleForRequest(
	baseUrl: string,
	runId: string,
	requestHeaders: Headers
): Promise<StudioRunDebugBundle> {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	return requestJsonWithForwardedHeaders<StudioRunDebugBundle>(
		`${normalizedBaseUrl}/api/runs/${encodeURIComponent(runId)}/debug`,
		requestHeaders,
		{ cache: "no-store" }
	);
}

export type { StudioRunDebugBundle } from "@generator/contracts/studio";
export type { AdminSnapshot } from "./shared";
