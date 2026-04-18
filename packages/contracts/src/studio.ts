import type {
	RunStatus,
	ScenarioParamValue,
	WorkflowField,
	WorkflowSummary,
} from "./generator";

export interface StudioScenarioRecord {
	createdAt?: string;
	generatorScenarioId?: string | null;
	id: string;
	name: string;
	params?: Record<string, ScenarioParamValue>;
	prompt: string;
	updatedAt?: string;
	workflowKey: string;
}

export interface CreateStudioScenarioInput {
	name: string;
	params?: Record<string, ScenarioParamValue>;
	prompt: string;
	workflowKey: string;
}

export interface StudioArtifactRecord {
	kind?: string;
	url?: string | null;
}

export interface StudioRunRecord {
	artifacts?: StudioArtifactRecord[];
	createdAt?: string;
	errorSummary?: string | null;
	generatorRunId?: string | null;
	id: string;
	inputImageUrl: string;
	inputPersonGenerationId?: string | null;
	inputPersonId?: string | null;
	/** Персона, чей LoRA подставлен в params при запуске (Studio → Cast). */
	loraPersonId?: string | null;
	providerEndpointId?: string | null;
	providerJobId?: string | null;
	scenarioId: string;
	status: RunStatus;
	workflowKey: string;
}

export interface CreateStudioRunInput {
	inputImageUrl?: string;
	inputPersonGenerationId?: string | null;
	inputPersonId?: string | null;
	/** Подставить loraUrl этой персоны в params (нужен PERSONS_API_URL на studio-api). */
	loraPersonId?: string | null;
	scenarioId: string;
}

export type StudioShotArtifactKind = "image" | "video" | "audio";

export interface StudioShotRecord {
	artifactKind: StudioShotArtifactKind;
	artifactUrl: string;
	createdAt: string;
	id: string;
	note: string | null;
	personGenerationId: string | null;
	personId: string | null;
	runId: string;
	scenarioId: string;
}

export interface CreateStudioShotInput {
	artifactKind?: StudioShotArtifactKind;
	artifactUrl: string;
	note?: string | null;
	personGenerationId?: string | null;
	personId?: string | null;
	runId: string;
}

export interface StudioInputAssetRecord {
	contentType: string;
	fileName: string;
	sizeBytes: number;
	storage: "local" | "s3";
	url: string;
}

export interface StudioWorkflowSummary extends WorkflowSummary {
	parameterFields: readonly WorkflowField[];
}

export interface StudioSnapshot {
	runs: StudioRunRecord[];
	scenarios: StudioScenarioRecord[];
	shots: StudioShotRecord[];
	source: "server";
	warnings: string[];
	workflows: StudioWorkflowSummary[];
}
