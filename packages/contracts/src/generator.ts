export type WorkflowParameterType = "text" | "number";
export type WorkflowParameterKind = "lora-url";
export type WorkflowBaseModel = "z-image" | "flux" | "sdxl" | "other";
export type RunStatus = "queued" | "running" | "succeeded" | "failed";
export type ScenarioParamValue = string | number | boolean | null;

export interface WorkflowField {
	description: string;
	enumValues?: readonly string[];
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

export interface WorkflowSummary {
	baseModel?: WorkflowBaseModel;
	defaults: Record<string, unknown>;
	description: string;
	key: string;
	name: string;
	parameterFields: readonly WorkflowField[];
	requiresInputImage?: boolean;
}

export interface GeneratorScenarioRecord {
	createdAt?: string;
	id: string;
	name: string;
	params?: Record<string, unknown>;
	prompt: string;
	updatedAt?: string;
	workflowKey: string;
}

export interface CreateGeneratorScenarioInput {
	name: string;
	params?: Record<string, unknown>;
	prompt: string;
	workflowKey: string;
}

export interface GeneratorArtifactRecord {
	url?: string | null;
}

export interface GeneratorRunRecord {
	artifacts?: GeneratorArtifactRecord[];
	createdAt?: string;
	errorSummary?: string | null;
	id: string;
	inputImageUrl: string;
	providerEndpointId?: string | null;
	providerJobId?: string | null;
	scenarioId: string;
	status: RunStatus;
	workflowKey: string;
}

export interface CreateGeneratorRunInput {
	inputImageUrl?: string;
	scenarioId: string;
}

export interface GeneratorHealthResponse {
	ok: boolean;
	workflows: number;
}

export interface CreateGeneratorExecutionInput {
	callback?: {
		context?: Record<string, unknown>;
		token?: string;
		url?: string;
	};
	inputImageUrl?: string;
	params?: Record<string, unknown>;
	prompt: string;
	workflowKey: string;
}

export interface SyncGeneratorExecutionInput {
	providerEndpointId?: string;
	providerJobId: string;
	workflowKey: string;
}

export interface GeneratorExecutionRecord {
	artifacts: GeneratorArtifactRecord[];
	errorSummary: string | null;
	id: string;
	inputImageUrl: string;
	progressPct?: number | null;
	providerEndpointId: string | null;
	providerJobId: string | null;
	status: RunStatus;
	workflowKey: string;
}
