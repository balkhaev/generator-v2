import type {
	CreateRunpodNetworkVolumeInput,
	CreateRunpodPodTemplateInput,
	ListRunpodPodTemplatesQuery,
	RunpodNetworkVolume,
	RunpodPodTemplate,
	UpdateRunpodNetworkVolumeInput,
	UpdateRunpodPodTemplateInput,
} from "@generator/contracts/runpod-admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

const VOLUMES_PATH = "/api/admin/runpod/volumes";
const TEMPLATES_PATH = "/api/admin/runpod/pod-templates";
const SCENARIO_BINDING_PATH = "/api/admin/scenarios/runpod-binding";

function buildTemplatesQueryString(query: ListRunpodPodTemplatesQuery): string {
	const params = new URLSearchParams();
	if (query.enabled !== undefined) {
		params.set("enabled", query.enabled ? "true" : "false");
	}
	if (query.mode) {
		params.set("mode", query.mode);
	}
	if (query.workflowKey) {
		params.set("workflowKey", query.workflowKey);
	}
	const str = params.toString();
	return str ? `?${str}` : "";
}

export async function fetchRunpodVolumes() {
	const payload = await requestJson<{ volumes: RunpodNetworkVolume[] }>(
		`${API_BASE_URL}${VOLUMES_PATH}`,
		{ credentials: "include" }
	);
	return payload.volumes;
}

export async function createRunpodVolume(
	input: CreateRunpodNetworkVolumeInput
) {
	const payload = await requestJson<{ volume: RunpodNetworkVolume }>(
		`${API_BASE_URL}${VOLUMES_PATH}`,
		{
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}
	);
	return payload.volume;
}

export async function updateRunpodVolume(
	id: string,
	patch: UpdateRunpodNetworkVolumeInput
) {
	const payload = await requestJson<{ volume: RunpodNetworkVolume }>(
		`${API_BASE_URL}${VOLUMES_PATH}/${encodeURIComponent(id)}`,
		{
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		}
	);
	return payload.volume;
}

export async function deleteRunpodVolume(id: string) {
	const payload = await requestJson<{ volume: RunpodNetworkVolume }>(
		`${API_BASE_URL}${VOLUMES_PATH}/${encodeURIComponent(id)}`,
		{ method: "DELETE", credentials: "include" }
	);
	return payload.volume;
}

export async function fetchRunpodPodTemplates(
	query: ListRunpodPodTemplatesQuery = {}
) {
	const payload = await requestJson<{ templates: RunpodPodTemplate[] }>(
		`${API_BASE_URL}${TEMPLATES_PATH}${buildTemplatesQueryString(query)}`,
		{ credentials: "include" }
	);
	return payload.templates;
}

export async function createRunpodPodTemplate(
	input: CreateRunpodPodTemplateInput
) {
	const payload = await requestJson<{ template: RunpodPodTemplate }>(
		`${API_BASE_URL}${TEMPLATES_PATH}`,
		{
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}
	);
	return payload.template;
}

export async function updateRunpodPodTemplate(
	id: string,
	patch: UpdateRunpodPodTemplateInput
) {
	const payload = await requestJson<{ template: RunpodPodTemplate }>(
		`${API_BASE_URL}${TEMPLATES_PATH}/${encodeURIComponent(id)}`,
		{
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		}
	);
	return payload.template;
}

export async function deleteRunpodPodTemplate(id: string) {
	const payload = await requestJson<{ template: RunpodPodTemplate }>(
		`${API_BASE_URL}${TEMPLATES_PATH}/${encodeURIComponent(id)}`,
		{ method: "DELETE", credentials: "include" }
	);
	return payload.template;
}

export interface ScenarioRunpodBinding {
	podTemplateId: string | null;
	podTemplateName: string | null;
	scenarioId: string;
	workflowKey: string;
}

export async function fetchScenarioRunpodBindings() {
	const payload = await requestJson<{ bindings: ScenarioRunpodBinding[] }>(
		`${API_BASE_URL}${SCENARIO_BINDING_PATH}`,
		{ credentials: "include" }
	);
	return payload.bindings;
}

export async function setScenarioRunpodBinding(
	scenarioId: string,
	podTemplateId: string | null
) {
	const payload = await requestJson<{ binding: ScenarioRunpodBinding }>(
		`${API_BASE_URL}${SCENARIO_BINDING_PATH}/${encodeURIComponent(scenarioId)}`,
		{
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ podTemplateId }),
		}
	);
	return payload.binding;
}
