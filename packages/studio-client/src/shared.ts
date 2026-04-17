import type {
	AssetReleasePreset,
	AssetReleaseSnapshot,
} from "@generator/contracts/admin";
import type {
	WorkflowSummary as ServerWorkflowSummary,
	WorkflowBaseModel,
	WorkflowParameterKind,
	WorkflowParameterType,
} from "@generator/contracts/generator";
import type {
	CreateStudioRunInput,
	CreateStudioScenarioInput,
	StudioRunRecord as ServerRunRecord,
	StudioScenarioRecord as ServerScenarioRecord,
	StudioInputAssetRecord,
} from "@generator/contracts/studio";

export type { WorkflowParameterType } from "@generator/contracts/generator";
export type {
	CreateStudioRunInput,
	CreateStudioScenarioInput,
	StudioInputAssetRecord,
	StudioSnapshot,
} from "@generator/contracts/studio";

export type ScenarioParamValue = string | number | boolean | null;

export interface WorkflowParameter {
	defaultValue: string;
	enumValues?: readonly string[];
	helperText: string;
	key: string;
	kind?: WorkflowParameterKind;
	label: string;
	max?: number;
	min?: number;
	optional?: boolean;
	step?: number;
	type: WorkflowParameterType;
	unit?: string;
}

export interface WorkflowDefinition {
	baseModel?: WorkflowBaseModel;
	key: string;
	name: string;
	parameters: WorkflowParameter[];
	promptHint: string;
	requiresInputImage: boolean;
	summary: string;
}

export type ScenarioRecord = ServerScenarioRecord;

export interface ScenarioRunRecord {
	artifactUrls: string[];
	createdAt: string;
	errorSummary?: string | null;
	id: string;
	inputImageUrl: string;
	inputLabel: string;
	providerEndpointId: string | null;
	providerJobId: string | null;
	scenarioId: string;
	scenarioName: string;
	status: "queued" | "running" | "succeeded" | "failed";
	workflowKey: string;
}

export interface AdminSnapshot {
	presets: AssetReleasePreset[];
	releases: AssetReleaseSnapshot[];
	runs: ScenarioRunRecord[];
	scenarios: ScenarioRecord[];
	source: "server";
	warnings: string[];
	workflows: WorkflowDefinition[];
}

export interface ScenarioFormState {
	name: string;
	params: Record<string, string>;
	prompt: string;
	workflowKey: string;
}

export type CreateScenarioInput = CreateStudioScenarioInput;
export type LaunchRunInput = CreateStudioRunInput;
export type UploadedInputAsset = StudioInputAssetRecord;

export interface MutationResult<T> {
	data: T;
	source: "server";
}

type JsonRecord = Record<string, unknown>;

const fileExtensionPattern = /\.[a-z0-9]+$/i;

function isObject(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null;
}

function toParamValue(value: unknown): ScenarioParamValue {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}

	return JSON.stringify(value);
}

function stringifyParamValue(value: unknown) {
	if (value === undefined || value === null) {
		return "";
	}

	return String(value);
}

function createPromptHint(workflowName: string) {
	return `Describe the ${workflowName} shot, camera movement, and effect you want the generated clip to amplify.`;
}

function formatInputLabel(inputImageUrl: string) {
	try {
		const url = new URL(inputImageUrl);
		const lastPathSegment = url.pathname
			.split("/")
			.filter(Boolean)
			.at(-1)
			?.replace(fileExtensionPattern, "");

		return lastPathSegment || url.hostname;
	} catch {
		return inputImageUrl;
	}
}

function sortByNewest<T extends { createdAt?: string; updatedAt?: string }>(
	records: T[]
) {
	return [...records].sort((left, right) => {
		const leftDate = left.updatedAt ?? left.createdAt ?? "";
		const rightDate = right.updatedAt ?? right.createdAt ?? "";

		return rightDate.localeCompare(leftDate);
	});
}

function normalizeWorkflowDefinition(
	workflow: ServerWorkflowSummary
): WorkflowDefinition {
	return {
		baseModel: workflow.baseModel,
		key: workflow.key,
		name: workflow.name,
		parameters: (workflow.parameterFields ?? []).map((parameter) => ({
			defaultValue: stringifyParamValue(workflow.defaults?.[parameter.key]),
			...(parameter.enumValues ? { enumValues: parameter.enumValues } : {}),
			helperText: parameter.description,
			key: parameter.key,
			...(parameter.kind ? { kind: parameter.kind } : {}),
			label: parameter.label,
			...(parameter.max === undefined ? {} : { max: parameter.max }),
			...(parameter.min === undefined ? {} : { min: parameter.min }),
			...(parameter.optional ? { optional: parameter.optional } : {}),
			...(parameter.step === undefined ? {} : { step: parameter.step }),
			type: parameter.type,
			...(parameter.unit ? { unit: parameter.unit } : {}),
		})),
		promptHint: createPromptHint(workflow.name),
		requiresInputImage: Boolean(workflow.requiresInputImage),
		summary: workflow.description,
	};
}

function normalizeScenarioRecord(record: ServerScenarioRecord): ScenarioRecord {
	return {
		createdAt: record.createdAt,
		generatorScenarioId: record.generatorScenarioId,
		id: record.id,
		name: record.name,
		params: Object.fromEntries(
			Object.entries(record.params ?? {}).map(([key, value]) => [
				key,
				toParamValue(value),
			])
		),
		prompt: record.prompt,
		updatedAt: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
		workflowKey: record.workflowKey,
	};
}

function normalizeRunRecord(
	record: ServerRunRecord,
	scenarioNames: ReadonlyMap<string, string>
): ScenarioRunRecord {
	return {
		artifactUrls: (record.artifacts ?? [])
			.flatMap((artifact) => artifact.url ?? [])
			.filter((artifactUrl): artifactUrl is string => Boolean(artifactUrl)),
		createdAt: record.createdAt ?? new Date().toISOString(),
		errorSummary: record.errorSummary ?? null,
		id: record.id,
		inputImageUrl: record.inputImageUrl,
		inputLabel: formatInputLabel(record.inputImageUrl),
		providerEndpointId: record.providerEndpointId ?? null,
		providerJobId: record.providerJobId ?? null,
		scenarioId: record.scenarioId,
		scenarioName: scenarioNames.get(record.scenarioId) ?? "Unknown scenario",
		status: record.status,
		workflowKey: record.workflowKey,
	};
}

function extractCollection<T>(payload: unknown, key: string): T[] {
	if (Array.isArray(payload)) {
		return payload as T[];
	}

	if (isObject(payload) && Array.isArray(payload[key])) {
		return payload[key] as T[];
	}

	return [];
}

function extractRecord<T>(payload: unknown, key: string): T | null {
	if (isObject(payload) && isObject(payload[key])) {
		return payload[key] as T;
	}

	if (isObject(payload)) {
		return payload as T;
	}

	return null;
}

export function createScenarioFormState(
	workflow: WorkflowDefinition
): ScenarioFormState {
	return {
		name: "",
		params: Object.fromEntries(
			workflow.parameters.map((parameter) => [
				parameter.key,
				parameter.defaultValue,
			])
		),
		prompt: "",
		workflowKey: workflow.key,
	};
}

export function buildCreateScenarioInput(
	workflow: WorkflowDefinition,
	form: ScenarioFormState
): CreateScenarioInput {
	const normalizedParams: [string, ScenarioParamValue][] = [];

	for (const parameter of workflow.parameters) {
		const rawValue = form.params[parameter.key]?.trim() ?? "";

		if (parameter.optional && rawValue === "") {
			continue;
		}

		if (parameter.type === "number") {
			if (rawValue === "") {
				continue;
			}

			const parsedValue = Number(rawValue);

			if (!Number.isFinite(parsedValue)) {
				throw new Error(`${parameter.label} must be a valid number.`);
			}

			normalizedParams.push([parameter.key, parsedValue]);
			continue;
		}

		normalizedParams.push([parameter.key, rawValue]);
	}

	return {
		name: form.name,
		params: Object.fromEntries(normalizedParams) as Record<
			string,
			ScenarioParamValue
		>,
		prompt: form.prompt,
		workflowKey: form.workflowKey,
	};
}

export function normalizeStudioSnapshot(params: {
	presetsPayload: unknown;
	releasesPayload: unknown;
	runsPayload: unknown;
	scenariosPayload: unknown;
	workflowsPayload: unknown;
}): AdminSnapshot {
	const scenarios = sortByNewest(
		extractCollection<ServerScenarioRecord>(
			params.scenariosPayload,
			"scenarios"
		).map(normalizeScenarioRecord)
	);
	const scenarioNames = new Map(
		scenarios.map((scenario) => [scenario.id, scenario.name])
	);

	return {
		presets: extractCollection<AssetReleasePreset>(
			params.presetsPayload,
			"presets"
		),
		releases: extractCollection<AssetReleaseSnapshot>(
			params.releasesPayload,
			"releases"
		),
		runs: sortByNewest(
			extractCollection<ServerRunRecord>(params.runsPayload, "runs").map(
				(run) => normalizeRunRecord(run, scenarioNames)
			)
		),
		scenarios,
		source: "server",
		warnings: [],
		workflows: extractCollection<ServerWorkflowSummary>(
			params.workflowsPayload,
			"workflows"
		).map(normalizeWorkflowDefinition),
	};
}

export function extractStudioScenario(
	payload: unknown,
	key = "scenario"
): ScenarioRecord {
	const scenario = extractRecord<ServerScenarioRecord>(payload, key);

	if (!scenario) {
		throw new Error("Scenario response did not include a scenario record.");
	}

	return normalizeScenarioRecord(scenario);
}

export function extractStudioRun(
	payload: unknown,
	scenarioNames: ReadonlyMap<string, string>,
	key = "run"
): ScenarioRunRecord {
	const run = extractRecord<ServerRunRecord>(payload, key);

	if (!run) {
		throw new Error("Run response did not include a run record.");
	}

	return normalizeRunRecord(run, scenarioNames);
}
