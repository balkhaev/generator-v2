import type { RunStatus } from "./generator";
import type { PersonLoraTrainingMeta } from "./persons";

export type AssetReleaseGroup =
	| "checkpoints"
	| "models"
	| "loras"
	| "vae"
	| "workflows";

export type AssetReleaseStatus =
	| "distributing"
	| "ready"
	| "degraded"
	| "failed";

export type VolumeDistributionStatus =
	| "queued"
	| "syncing"
	| "verifying"
	| "succeeded"
	| "failed";

export interface AssetReleaseItemSnapshot {
	fileName: string;
	id: string;
	sizeBytes: number;
	targetRelativePath: string;
}

export interface VolumeDistributionJobSnapshot {
	bytesSynced: number;
	bytesTotal: number;
	errorSummary: string | null;
	filesSynced: number;
	filesTotal: number;
	id: string;
	lastHeartbeatAt: string | null;
	podId: string | null;
	progressPct: number;
	region: string | null;
	status: VolumeDistributionStatus;
	updatedAt: string;
	volumeId: string;
	volumeName: string | null;
}

export interface AssetReleaseSnapshot {
	bytesTotal: number;
	completedAt: string | null;
	createdAt: string;
	errorSummary: string | null;
	filesTotal: number;
	group: AssetReleaseGroup;
	id: string;
	items: AssetReleaseItemSnapshot[];
	jobs: VolumeDistributionJobSnapshot[];
	label: string;
	progressPct: number;
	status: AssetReleaseStatus;
	volumesFailed: number;
	volumesReady: number;
	volumesTotal: number;
}

export interface AssetReleasePresetAsset {
	description: string;
	fileName: string;
	group: AssetReleaseGroup;
	label: string;
}

export interface AssetReleasePreset {
	assets: AssetReleasePresetAsset[];
	description: string;
	id: string;
	name: string;
	sourceUrl: string;
	workflowKeys: string[];
}

export interface DashboardRecentRun {
	artifactCount: number;
	createdAt: string;
	errorSummary: string | null;
	id: string;
	inputImageUrl: string;
	inputLabel: string;
	primaryArtifactUrl: string | null;
	providerEndpointId: string | null;
	providerJobId: string | null;
	scenarioName: string;
	status: RunStatus;
	workflowKey: string;
}

export interface DashboardRunStatusSummary {
	failed: number;
	queued: number;
	running: number;
	succeeded: number;
}

export interface DashboardScenarioSummary {
	id: string;
	lastRunAt: string | null;
	lastRunStatus: RunStatus | null;
	name: string;
	runCount: number;
	updatedAt: string;
	workflowKey: string;
}

export interface DashboardLoraTrainingSnapshot {
	datasetUrl: string | null;
	loraUrl: string | null;
	personId: string;
	personName: string;
	personSlug: string;
	referencePhotoUrl: string;
	training: PersonLoraTrainingMeta | null;
	updatedAt: string;
}

export interface AdminDashboardSnapshot {
	loraTrainings: DashboardLoraTrainingSnapshot[];
	notices: string[];
	recentRuns: DashboardRecentRun[];
	runStatus: DashboardRunStatusSummary;
	scenarios: DashboardScenarioSummary[];
	snapshotAt: string;
}

export interface AdminSetupStatus {
	setupRequired: boolean;
}

export type TrainingProviderName = "fal" | "runpod";

export interface TrainingProviderAvailability {
	configured: boolean;
	missing: string[];
	provider: TrainingProviderName;
}

export interface TrainingProviderSettingsSnapshot {
	availability: TrainingProviderAvailability[];
	provider: TrainingProviderName;
}

export interface DatasetBuilderSettings {
	guidanceScale: number;
	model: string;
	negativePromptPreview: string;
	note: string;
	pollMs: number;
	timeoutMs: number;
}

export interface RunpodTrainingSettings {
	baseModel: string;
	endpointConfigured: boolean;
	endpointId: string | null;
	pollMs: number;
	timeoutMs: number;
}

export interface PersonsWorkflowDefaults {
	avatarPreviewWorkflow: string;
	avatarRefineWorkflow: string;
	avatarWorkflow: string;
	loraWorkflow: string;
}

export interface GeneratorRuntimeSettings {
	reconcileIntervalMs: number;
	reconcileWatch: boolean;
}

export interface AdminSettingsSnapshot {
	datasetBuilder: DatasetBuilderSettings;
	generatorRuntime: GeneratorRuntimeSettings;
	personsDefaults: PersonsWorkflowDefaults;
	runpodTraining: RunpodTrainingSettings;
	trainingProvider: TrainingProviderSettingsSnapshot;
}
