import type {
	LoraBaseModel,
	LoraRegistryEntry,
} from "@generator/contracts/loras";
import type {
	CreatePersonInput,
	ImportGenerationInput,
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

export type { LoraRegistryEntry } from "@generator/contracts/loras";
export type {
	CreatePersonInput,
	ImportGenerationInput,
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export interface PersonsDashboard {
	persons: PersonRecord[];
	warnings: string[];
}

export async function getPersonsDashboard(): Promise<PersonsDashboard> {
	const warnings: string[] = [];

	try {
		const result = await requestJson<{ persons: PersonRecord[] }>(
			`${API_BASE_URL}/api/persons`,
			{ cache: "no-store" }
		);
		return { persons: result.persons, warnings };
	} catch (error) {
		warnings.push(
			error instanceof Error ? error.message : "Failed to load persons"
		);
		return { persons: [], warnings };
	}
}

export async function createPerson(input: CreatePersonInput) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons`,
		{
			method: "POST",
			body: JSON.stringify(input),
			headers: {
				"content-type": "application/json",
			},
		}
	);
	return payload.person;
}

export async function importGeneration(
	personId: string,
	input: ImportGenerationInput
) {
	const payload = await requestJson<{ generation: PersonGenerationRecord }>(
		`${API_BASE_URL}/api/persons/${personId}/generations/import`,
		{
			method: "POST",
			body: JSON.stringify(input),
			headers: {
				"content-type": "application/json",
			},
		}
	);
	return payload.generation;
}

export async function deleteGeneration(personId: string, generationId: string) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons/${personId}/generations/${generationId}`,
		{
			method: "DELETE",
		}
	);
	return payload.person;
}

export async function findPersonByOperatorRunId(operatorRunId: string) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons/lookup/run/${operatorRunId}`,
		{
			cache: "no-store",
		}
	);

	return payload.person;
}

export async function trainPersonLora(personId: string) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons/${personId}/train-lora`,
		{
			method: "POST",
			body: JSON.stringify({}),
			headers: { "content-type": "application/json" },
		}
	);
	return payload.person;
}

export async function fetchLoras(
	baseModel?: LoraBaseModel
): Promise<LoraRegistryEntry[]> {
	const params = new URLSearchParams();
	if (baseModel) {
		params.set("baseModel", baseModel);
	}
	const query = params.toString();
	try {
		const payload = await requestJson<{ loras: LoraRegistryEntry[] }>(
			`${API_BASE_URL}/api/loras${query ? `?${query}` : ""}`,
			{ cache: "no-store" }
		);
		return payload.loras;
	} catch {
		return [];
	}
}

export async function generateWithLora(
	personId: string,
	prompt: string,
	options?: {
		extraLoraUrl?: string;
		extraLoraWeight?: number;
	}
) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons/${personId}/generate-with-lora`,
		{
			method: "POST",
			body: JSON.stringify({
				prompt,
				...(options?.extraLoraUrl
					? {
							extraLoraUrl: options.extraLoraUrl,
							extraLoraWeight: options.extraLoraWeight ?? 0.05,
						}
					: {}),
			}),
			headers: { "content-type": "application/json" },
		}
	);
	return payload.person;
}
