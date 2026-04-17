import type { AssetReleasePreset, AssetReleaseSnapshot } from "./admin";
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
	providerEndpointId?: string | null;
	providerJobId?: string | null;
	scenarioId: string;
	status: RunStatus;
	workflowKey: string;
}

export interface CreateStudioRunInput {
	inputImageUrl?: string;
	scenarioId: string;
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
	presets: AssetReleasePreset[];
	releases: AssetReleaseSnapshot[];
	runs: StudioRunRecord[];
	scenarios: StudioScenarioRecord[];
	source: "server";
	warnings: string[];
	workflows: StudioWorkflowSummary[];
}
