import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import type {
	LoraBaseModel,
	LoraRegistryEntry,
} from "@generator/contracts/loras";
import type {
	CreatePersonInput,
	ImportGenerationInput,
	PersonGenerationRecord,
	PersonRecord,
	UpdatePersonInput,
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
	UpdatePersonInput,
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

async function getErrorMessage(response: Response) {
	try {
		const payload = (await response.json()) as { error?: unknown };
		if (typeof payload.error === "string" && payload.error.length > 0) {
			return payload.error;
		}
	} catch {
		// Fall back to text below.
	}

	try {
		const text = await response.text();
		if (text.length > 0) {
			return text;
		}
	} catch {
		// Fall back to the status line below.
	}

	return `${response.status} ${response.statusText}`.trim();
}

async function requestEmpty(input: string, init?: RequestInit) {
	const response = await fetch(input, {
		...init,
		credentials: init?.credentials ?? "include",
	});

	if (!response.ok) {
		throw new Error(await getErrorMessage(response));
	}
}

export async function updatePerson(personId: string, input: UpdatePersonInput) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons/${personId}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
			headers: {
				"content-type": "application/json",
			},
		}
	);
	return payload.person;
}

export function deletePerson(personId: string) {
	return requestEmpty(`${API_BASE_URL}/api/persons/${personId}`, {
		method: "DELETE",
	});
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

export async function cancelGeneration(personId: string, generationId: string) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons/${personId}/generations/${generationId}/cancel`,
		{
			method: "POST",
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

export interface AvatarPreviewBatch {
	enhanced: boolean;
	executions: GeneratorExecutionRecord[];
	prompts: string[];
}

export async function requestAvatarPreviews(input: {
	prompt: string;
	count?: number;
	enhance?: boolean;
}): Promise<AvatarPreviewBatch> {
	const payload = await requestJson<{
		batch: AvatarPreviewBatch;
		execution: GeneratorExecutionRecord;
	}>(`${API_BASE_URL}/api/persons/avatar-previews`, {
		method: "POST",
		body: JSON.stringify(input),
		headers: { "content-type": "application/json" },
	});
	return payload.batch;
}

export async function refineAvatarPreviews(input: {
	sourcePrompt: string;
	sourceImageUrl: string;
	instruction: string;
	count?: number;
}): Promise<AvatarPreviewBatch> {
	const payload = await requestJson<{
		batch: AvatarPreviewBatch;
		execution: GeneratorExecutionRecord;
	}>(`${API_BASE_URL}/api/persons/avatar-previews/refine`, {
		method: "POST",
		body: JSON.stringify(input),
		headers: { "content-type": "application/json" },
	});
	return payload.batch;
}

export async function getAvatarPreview(executionId: string) {
	const payload = await requestJson<{ execution: GeneratorExecutionRecord }>(
		`${API_BASE_URL}/api/persons/avatar-previews/${executionId}`,
		{ cache: "no-store" }
	);
	return payload.execution;
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

export async function cancelPersonLoraTraining(personId: string) {
	const payload = await requestJson<{ person: PersonRecord }>(
		`${API_BASE_URL}/api/persons/${personId}/train-lora/cancel`,
		{
			method: "POST",
		}
	);
	return payload.person;
}

export interface UploadedPersonsImage {
	contentType: string;
	fileName: string;
	sizeBytes: number;
	storage: "s3";
	url: string;
}

export async function uploadPersonsImage(
	file: File
): Promise<UploadedPersonsImage> {
	const formData = new FormData();
	formData.append("file", file);

	const response = await fetch(`${API_BASE_URL}/api/input-assets`, {
		body: formData,
		credentials: "include",
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(await getErrorMessage(response));
	}

	const payload = (await response.json()) as { upload: UploadedPersonsImage };
	return payload.upload;
}

export async function enhancePersonsPrompt(prompt: string): Promise<string> {
	const payload = await requestJson<{ enhanced?: unknown }>(
		`${API_BASE_URL}/api/enhance-prompt`,
		{
			method: "POST",
			body: JSON.stringify({ prompt }),
			headers: { "content-type": "application/json" },
		}
	);

	if (typeof payload.enhanced !== "string" || payload.enhanced.trim() === "") {
		throw new Error("Enhance response did not contain enhanced text.");
	}

	return payload.enhanced;
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
		enhance?: boolean;
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
				...(options?.enhance ? { enhance: true } : {}),
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
