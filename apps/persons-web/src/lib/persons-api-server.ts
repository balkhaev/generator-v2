import { env } from "@generator/env/web";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";
import type { Headers } from "next/dist/compiled/@edge-runtime/primitives";

import type { PersonRecord } from "@/lib/persons-api";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function getPersonsDashboardForRequest(requestHeaders: Headers) {
	const warnings: string[] = [];

	try {
		const result = await requestJsonWithForwardedHeaders<{
			persons: PersonRecord[];
		}>(`${API_BASE_URL}/api/persons`, requestHeaders, { cache: "no-store" });
		return { persons: result.persons, warnings };
	} catch (error) {
		warnings.push(
			error instanceof Error ? error.message : "Failed to load persons"
		);
		return { persons: [], warnings };
	}
}
