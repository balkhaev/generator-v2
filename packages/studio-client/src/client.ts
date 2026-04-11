import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

import type {
	AdminSnapshot,
	CreateScenarioInput,
	LaunchRunInput,
	MutationResult,
	ScenarioRecord,
	ScenarioRunRecord,
	UploadedInputAsset,
} from "./shared";
import { extractStudioRun, extractStudioScenario } from "./shared";

const apiBaseUrl = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

function requestStudioJson<T>(input: string, init?: RequestInit) {
	return requestJson<T>(input, {
		credentials: "include",
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

export function getStudioSnapshot(): Promise<AdminSnapshot> {
	return requestStudioJson<AdminSnapshot>(`${apiBaseUrl}/api/studio-snapshot`);
}

export async function createStudioScenario(
	input: CreateScenarioInput
): Promise<MutationResult<ScenarioRecord>> {
	const payload = await requestStudioJson<unknown>(
		`${apiBaseUrl}/api/scenarios`,
		{
			body: JSON.stringify(input),
			method: "POST",
		}
	);

	return {
		data: extractStudioScenario(payload),
		source: "server",
	};
}

export async function launchStudioRun(
	input: LaunchRunInput
): Promise<MutationResult<ScenarioRunRecord>> {
	const payload = await requestStudioJson<unknown>(`${apiBaseUrl}/api/runs`, {
		body: JSON.stringify(input),
		method: "POST",
	});
	const snapshot = await getStudioSnapshot();
	const scenarioNames = new Map(
		snapshot.scenarios.map((scenario) => [scenario.id, scenario.name])
	);

	return {
		data: await extractStudioRun(payload, scenarioNames),
		source: "server",
	};
}

export function uploadStudioInputImage(input: {
	file: File;
	onProgress?: (progressPct: number) => void;
}) {
	const formData = new FormData();

	formData.append("file", input.file);

	return fetch(`${apiBaseUrl}/api/input-assets`, {
		body: formData,
		credentials: "include",
		method: "POST",
	})
		.then(async (response) => {
			if (!response.ok) {
				throw new Error(await response.text());
			}

			input.onProgress?.(100);
			return (await response.json()) as { upload: UploadedInputAsset };
		})
		.then((payload) => payload.upload);
}

export async function syncStudioRun(
	runId: string
): Promise<MutationResult<ScenarioRunRecord>> {
	const payload = await requestStudioJson<unknown>(
		`${apiBaseUrl}/api/runs/${runId}/sync`,
		{
			method: "POST",
		}
	);
	const snapshot = await getStudioSnapshot();
	const scenarioNames = new Map(
		snapshot.scenarios.map((scenario) => [scenario.id, scenario.name])
	);

	return {
		data: await extractStudioRun(payload, scenarioNames),
		source: "server",
	};
}

export type {
	AdminSnapshot,
	CreateScenarioInput,
	LaunchRunInput,
	MutationResult,
	ScenarioFormState,
	ScenarioParamValue,
	ScenarioRecord,
	ScenarioRunRecord,
	UploadedInputAsset,
	WorkflowDefinition,
	WorkflowParameter,
	WorkflowParameterType,
} from "./shared";
