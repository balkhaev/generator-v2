export type PersonGenerationMediaType = "image" | "video" | "audio";
export type PersonGenerationStatus = "ready" | "queued" | "failed";
export type PersonLoraTrainingStatus =
	| "queued"
	| "generating"
	| "training"
	| "publishing"
	| "ready"
	| "failed";

export interface PersonLoraTrainingHistoryEntry {
	at: string;
	errorSummary: string | null;
	phase: string | null;
	progressPct: number | null;
	providerJobId: string | null;
	providerRequestId: string | null;
	providerStatus: string | null;
	referenceImageCount: number | null;
	status: PersonLoraTrainingStatus;
}

export interface PersonLoraTrainingMeta {
	assetReleaseId?: string | null;
	completedAt?: string | null;
	datasetUrl?: string | null;
	datasetZipSizeBytes?: number | null;
	debug?: Record<string, unknown>;
	debugCorrelationId?: string | null;
	errorSummary?: string | null;
	failedAt?: string | null;
	history?: PersonLoraTrainingHistoryEntry[];
	lastEventAt?: string | null;
	loraUrl?: string | null;
	outputName?: string | null;
	phase?: string | null;
	progressPct?: number | null;
	provider?: string | null;
	providerJobId?: string | null;
	providerRequestId?: string | null;
	providerStatus?: string | null;
	referenceImageCount?: number | null;
	referenceImageTargetCount?: number | null;
	referenceImageUrls?: string[];
	referencePrompt?: string | null;
	requestedAt?: string | null;
	startedAt?: string | null;
	status?: PersonLoraTrainingStatus;
	trainingElapsedMs?: number | null;
	trainingRunId?: string | null;
	trainingStartedAt?: string | null;
	trainingSteps?: number | null;
	triggerWord?: string | null;
	updatedAt?: string | null;
	uploadMethod?: string | null;
}

export interface PersonGenerationRecord {
	createdAt: string;
	errorSummary: string | null;
	id: string;
	mediaType: PersonGenerationMediaType;
	metadata: Record<string, unknown>;
	operatorRunId: string | null;
	operatorScenarioId: string | null;
	personId: string;
	previewUrl: string | null;
	prompt: string;
	sourceUrl: string;
	status: PersonGenerationStatus;
	title: string;
	updatedAt: string;
}

export interface PersonRecord {
	createdAt: string;
	datasetUrl: string | null;
	description: string;
	generations: PersonGenerationRecord[];
	id: string;
	loraUrl: string | null;
	metadata: Record<string, unknown>;
	name: string;
	photoUrl: string | null;
	referencePhotoUrl: string;
	slug: string;
	updatedAt: string;
	videoUrl: string | null;
	voiceWavUrl: string | null;
}

export interface CreatePersonInput {
	datasetUrl?: string;
	description?: string;
	loraUrl?: string;
	name: string;
	photoUrl?: string;
	referencePhotoUrl?: string;
	videoUrl?: string;
	voiceWavUrl?: string;
}

export interface CreatePersonFromPromptInput {
	datasetUrl?: string;
	description?: string;
	loraUrl?: string;
	name: string;
	photoUrl?: string;
	prompt: string;
	videoUrl?: string;
	voiceWavUrl?: string;
}

export interface ImportGenerationInput {
	prompt?: string;
	providerEndpointId?: string;
	providerJobId: string;
	title?: string;
	workflowKey: string;
}

export interface IntegrationStatus {
	configured: boolean;
	error?: string;
	health: {
		ok: boolean;
		workflows: number;
	} | null;
	status: "connected" | "error" | "unavailable";
}

export interface PersonsDashboardSnapshot {
	integration: IntegrationStatus;
	persons: PersonRecord[];
	warnings: string[];
}
