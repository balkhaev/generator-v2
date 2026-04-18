import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

import type {
	AdminSnapshot,
	CreateScenarioInput,
	LaunchRunInput,
	MutationResult,
	SaveShotInput,
	ScenarioRecord,
	ScenarioRunRecord,
	ScenarioShotRecord,
	UploadedInputAsset,
} from "./shared";
import {
	extractStudioRun,
	extractStudioScenario,
	extractStudioShot,
} from "./shared";

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

export async function enhanceStudioPrompt(
	prompt: string
): Promise<{ enhanced: string }> {
	const payload = await requestStudioJson<{ enhanced?: unknown }>(
		`${apiBaseUrl}/api/enhance-prompt`,
		{
			body: JSON.stringify({ prompt }),
			method: "POST",
		}
	);

	if (typeof payload.enhanced !== "string" || payload.enhanced.trim() === "") {
		throw new Error("Enhance response did not contain enhanced text.");
	}

	return { enhanced: payload.enhanced };
}

export async function saveStudioShot(
	input: SaveShotInput
): Promise<MutationResult<ScenarioShotRecord>> {
	const payload = await requestStudioJson<unknown>(
		`${apiBaseUrl}/api/scenario-shots`,
		{
			body: JSON.stringify(input),
			method: "POST",
		}
	);
	const snapshot = await getStudioSnapshot();
	const scenarioNames = new Map(
		snapshot.scenarios.map((scenario) => [scenario.id, scenario.name])
	);

	return {
		data: extractStudioShot(payload, scenarioNames),
		source: "server",
	};
}

export async function deleteStudioShot(shotId: string): Promise<void> {
	await requestStudioJson<{ ok?: boolean }>(
		`${apiBaseUrl}/api/scenario-shots/${shotId}`,
		{
			method: "DELETE",
		}
	);
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
	SaveShotInput,
	ScenarioFormState,
	ScenarioParamValue,
	ScenarioRecord,
	ScenarioRunRecord,
	ScenarioShotRecord,
	StudioShotArtifactKind,
	StudioShotRecord,
	UploadedInputAsset,
	WorkflowDefinition,
	WorkflowParameter,
	WorkflowParameterType,
} from "./shared";
