import "server-only";

import type { PersonRecord } from "@generator/contracts/persons";
import { requestJsonWithForwardedHeaders } from "@generator/http/server";
import { normalizeBaseUrl } from "@generator/http/shared";

const personsApiBaseUrl = normalizeBaseUrl(
	process.env.NEXT_PUBLIC_PERSONS_API_URL ?? "http://localhost:3003"
);

export interface PersonsListResult {
	persons: PersonRecord[];
	warnings: string[];
}

export async function listPersonsForRequest(
	requestHeaders: Headers
): Promise<PersonsListResult> {
	try {
		const payload = await requestJsonWithForwardedHeaders<{
			persons?: PersonRecord[];
		}>(`${personsApiBaseUrl}/api/persons`, requestHeaders);
		return { persons: payload.persons ?? [], warnings: [] };
	} catch (error) {
		return {
			persons: [],
			warnings: [
				error instanceof Error
					? error.message
					: "Failed to load persons for shots view.",
			],
		};
	}
}
