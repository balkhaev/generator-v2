import type { RunStatus } from "./generator";

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

export interface AdminDashboardSnapshot {
	notices: string[];
	recentRuns: DashboardRecentRun[];
	runStatus: DashboardRunStatusSummary;
	scenarios: DashboardScenarioSummary[];
	snapshotAt: string;
}

export interface AdminSetupStatus {
	setupRequired: boolean;
}
