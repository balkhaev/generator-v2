import type {
	WorkflowSummary as ServerWorkflowSummary,
	WorkflowBaseModel,
	WorkflowParameterKind,
	WorkflowParameterType,
} from "@generator/contracts/generator";
import type {
	CreateStudioRunInput,
	CreateStudioScenarioInput,
	CreateStudioShotInput,
	StudioRunRecord as ServerRunRecord,
	StudioScenarioRecord as ServerScenarioRecord,
	StudioShotRecord as ServerShotRecord,
	StudioInputAssetRecord,
	StudioShotArtifactKind,
} from "@generator/contracts/studio";

export type { WorkflowParameterType } from "@generator/contracts/generator";
export type {
	CreateStudioRunInput,
	CreateStudioScenarioInput,
	CreateStudioShotInput,
	StudioInputAssetRecord,
	StudioShotArtifactKind,
	StudioShotRecord,
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
	/** ID execution в generator-api (если ран уже привязан). */
	generatorRunId?: string | null;
	id: string;
	inputImageUrl: string;
	inputLabel: string;
	inputPersonGenerationId: string | null;
	inputPersonId: string | null;
	loraPersonId?: string | null;
	/** 0–100 при наличии данных от generator; иначе null. */
	progressPct?: number | null;
	providerEndpointId: string | null;
	providerJobId: string | null;
	scenarioId: string;
	scenarioName: string;
	status: "queued" | "running" | "succeeded" | "failed";
	workflowKey: string;
}

export interface ScenarioShotRecord {
	artifactKind: StudioShotArtifactKind;
	artifactUrl: string;
	createdAt: string;
	id: string;
	note: string | null;
	personGenerationId: string | null;
	personId: string | null;
	runId: string;
	scenarioId: string;
	scenarioName: string;
}

export interface AdminSnapshot {
	runs: ScenarioRunRecord[];
	scenarios: ScenarioRecord[];
	shots: ScenarioShotRecord[];
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
export type SaveShotInput = CreateStudioShotInput;
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
		generatorRunId: record.generatorRunId ?? null,
		id: record.id,
		inputImageUrl: record.inputImageUrl,
		inputLabel: formatInputLabel(record.inputImageUrl),
		inputPersonGenerationId: record.inputPersonGenerationId ?? null,
		inputPersonId: record.inputPersonId ?? null,
		loraPersonId: record.loraPersonId ?? null,
		progressPct: record.progressPct ?? null,
		providerEndpointId: record.providerEndpointId ?? null,
		providerJobId: record.providerJobId ?? null,
		scenarioId: record.scenarioId,
		scenarioName: scenarioNames.get(record.scenarioId) ?? "Unknown scenario",
		status: record.status,
		workflowKey: record.workflowKey,
	};
}

function normalizeShotRecord(
	record: ServerShotRecord,
	scenarioNames: ReadonlyMap<string, string>
): ScenarioShotRecord {
	return {
		artifactKind: record.artifactKind,
		artifactUrl: record.artifactUrl,
		createdAt: record.createdAt,
		id: record.id,
		note: record.note,
		personGenerationId: record.personGenerationId,
		personId: record.personId,
		runId: record.runId,
		scenarioId: record.scenarioId,
		scenarioName: scenarioNames.get(record.scenarioId) ?? "Unknown scenario",
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

export function buildScenarioFormStateFromRecord(
	scenario: ScenarioRecord,
	workflow: WorkflowDefinition
): ScenarioFormState {
	const baseParams = Object.fromEntries(
		workflow.parameters.map((parameter) => [
			parameter.key,
			parameter.defaultValue,
		])
	);

	for (const [key, value] of Object.entries(scenario.params ?? {})) {
		baseParams[key] = stringifyParamValue(value);
	}

	return {
		name: scenario.name,
		params: baseParams,
		prompt: scenario.prompt,
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
	runsPayload: unknown;
	scenariosPayload: unknown;
	shotsPayload?: unknown;
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
		runs: sortByNewest(
			extractCollection<ServerRunRecord>(params.runsPayload, "runs").map(
				(run) => normalizeRunRecord(run, scenarioNames)
			)
		),
		scenarios,
		shots: extractCollection<ServerShotRecord>(
			params.shotsPayload ?? [],
			"shots"
		)
			.map((shot) => normalizeShotRecord(shot, scenarioNames))
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
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

export function extractStudioShot(
	payload: unknown,
	scenarioNames: ReadonlyMap<string, string>,
	key = "shot"
): ScenarioShotRecord {
	const shot = extractRecord<ServerShotRecord>(payload, key);

	if (!shot) {
		throw new Error("Shot response did not include a shot record.");
	}

	return normalizeShotRecord(shot, scenarioNames);
}
