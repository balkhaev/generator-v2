import type {
	ImportGenerationInput,
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

export type {
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";

const personsApiBaseUrl = normalizeBaseUrl(
	env.NEXT_PUBLIC_PERSONS_API_URL ?? "http://localhost:3003"
);

function personsRequest<T>(input: string, init?: RequestInit) {
	return requestJson<T>(input, {
		credentials: "include",
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

export interface PersonsListResult {
	persons: PersonRecord[];
	warnings: string[];
}

export async function listPersons(): Promise<PersonsListResult> {
	const warnings: string[] = [];
	try {
		const payload = await personsRequest<{ persons: PersonRecord[] }>(
			`${personsApiBaseUrl}/api/persons`,
			{ cache: "no-store" }
		);
		return { persons: payload.persons, warnings };
	} catch (error) {
		warnings.push(
			error instanceof Error ? error.message : "Failed to load persons"
		);
		return { persons: [], warnings };
	}
}

export async function getPersonById(personId: string): Promise<PersonRecord> {
	const payload = await personsRequest<{ person: PersonRecord }>(
		`${personsApiBaseUrl}/api/persons/${personId}`,
		{ cache: "no-store" }
	);
	return payload.person;
}

export async function findPersonByOperatorRunId(
	operatorRunId: string
): Promise<PersonRecord> {
	const payload = await personsRequest<{ person: PersonRecord }>(
		`${personsApiBaseUrl}/api/persons/lookup/run/${operatorRunId}`,
		{ cache: "no-store" }
	);
	return payload.person;
}

export async function importGenerationToPerson(
	personId: string,
	input: ImportGenerationInput
): Promise<PersonGenerationRecord> {
	const payload = await personsRequest<{ generation: PersonGenerationRecord }>(
		`${personsApiBaseUrl}/api/persons/${personId}/generations/import`,
		{
			body: JSON.stringify(input),
			method: "POST",
		}
	);
	return payload.generation;
}

export interface GenerateWithLoraOptions {
	enhance?: boolean;
	extraLoraUrl?: string;
	extraLoraWeight?: number;
}

export async function generatePersonWithLora(
	personId: string,
	prompt: string,
	options?: GenerateWithLoraOptions
): Promise<PersonRecord> {
	const payload = await personsRequest<{ person: PersonRecord }>(
		`${personsApiBaseUrl}/api/persons/${personId}/generate-with-lora`,
		{
			body: JSON.stringify({
				prompt,
				...(options?.enhance ? { enhance: true } : {}),
				...(options?.extraLoraUrl
					? {
							extraLoraUrl: options.extraLoraUrl,
							extraLoraWeight: options.extraLoraWeight ?? 0.05,
						}
					: {}),
			}),
			method: "POST",
		}
	);
	return payload.person;
}

export function getPersonsApiBaseUrl() {
	return personsApiBaseUrl;
}

export function getPersonsWebUrl() {
	return env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3002";
}
