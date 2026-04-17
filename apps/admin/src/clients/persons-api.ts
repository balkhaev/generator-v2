import type { PersonRecord } from "@generator/contracts/persons";

const REQUEST_TIMEOUT_MS = 30_000;
const trailingSlashPattern = /\/+$/;

export interface PersonsApiClient {
	listPersons(): Promise<PersonRecord[]>;
}

export interface PersonsApiClientOptions {
	baseUrl: string;
	bearerToken: string;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
}

export function createPersonsApiClient(
	options: PersonsApiClientOptions
): PersonsApiClient {
	const trimmedBase = options.baseUrl.replace(trailingSlashPattern, "");
	const fetchFn = options.fetchFn ?? fetch;
	const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

	return {
		async listPersons() {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetchFn(`${trimmedBase}/api/internal/persons`, {
					headers: {
						authorization: `Bearer ${options.bearerToken}`,
					},
					signal: controller.signal,
				});
				if (!response.ok) {
					const detail = await response.text().catch(() => "");
					throw new Error(
						`persons-api listPersons failed (${response.status}${detail ? `: ${detail}` : ""})`
					);
				}
				const body = (await response.json()) as { persons?: PersonRecord[] };
				return body.persons ?? [];
			} finally {
				clearTimeout(timeout);
			}
		},
	};
}
