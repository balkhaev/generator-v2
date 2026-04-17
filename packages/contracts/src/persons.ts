export type PersonGenerationMediaType = "image" | "video" | "audio";
export type PersonGenerationStatus = "ready" | "queued" | "failed";
export type PersonLoraTrainingStatus =
	| "queued"
	| "generating"
	| "training"
	| "publishing"
	| "ready"
	| "failed";

export const PERSON_LORA_ACTIVE_TRAINING_STATUSES = [
	"queued",
	"generating",
	"training",
	"publishing",
] as const satisfies readonly PersonLoraTrainingStatus[];

export type ActivePersonLoraTrainingStatus =
	(typeof PERSON_LORA_ACTIVE_TRAINING_STATUSES)[number];

export const DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT = 20;

const PERSON_LORA_ACTIVE_TRAINING_STATUS_SET = new Set<string>(
	PERSON_LORA_ACTIVE_TRAINING_STATUSES
);

const PERSON_LORA_FALLBACK_PROGRESS: Record<PersonLoraTrainingStatus, number> =
	{
		failed: 100,
		generating: 32,
		publishing: 92,
		queued: 2,
		ready: 100,
		training: 76,
	};

const PROVIDER_TRAINING_BASE_PROGRESS = 76;
const PROVIDER_TRAINING_MAX_DISPLAY_PROGRESS = 89;
const PROVIDER_TRAINING_SOFT_PROGRESS_WINDOW_MS = 45 * 60 * 1000;

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
	cancelledAt?: string | null;
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

export function clampProgressPct(value: number) {
	return Math.max(0, Math.min(100, Math.round(value)));
}

export function isActivePersonLoraTrainingStatus(
	status: string | null | undefined
): status is ActivePersonLoraTrainingStatus {
	return (
		typeof status === "string" &&
		PERSON_LORA_ACTIVE_TRAINING_STATUS_SET.has(status)
	);
}

export function readPersonLoraTrainingMeta(
	person: Pick<PersonRecord, "metadata">
): PersonLoraTrainingMeta | null {
	const training = person.metadata?.training;
	if (training && typeof training === "object" && !Array.isArray(training)) {
		return training as PersonLoraTrainingMeta;
	}
	return null;
}

export function getPersonLoraTrainingDisplayStatus(
	training: PersonLoraTrainingMeta | null,
	hasLora: boolean
): PersonLoraTrainingStatus | undefined {
	if (isActivePersonLoraTrainingStatus(training?.status)) {
		return training.status;
	}
	if (training?.status === "failed") {
		return "failed";
	}
	if (training?.status === "ready" || hasLora) {
		return "ready";
	}
	return training?.status;
}

function getProviderTrainingSoftProgressPct(
	training: PersonLoraTrainingMeta | null,
	progressPct: number
) {
	if (training?.status !== "training") {
		return progressPct;
	}

	const elapsedMs = training.trainingElapsedMs;
	if (!(typeof elapsedMs === "number" && Number.isFinite(elapsedMs))) {
		return progressPct;
	}

	const elapsedRatio = Math.min(
		1,
		Math.max(0, elapsedMs) / PROVIDER_TRAINING_SOFT_PROGRESS_WINDOW_MS
	);
	const softProgressPct = clampProgressPct(
		PROVIDER_TRAINING_BASE_PROGRESS +
			elapsedRatio *
				(PROVIDER_TRAINING_MAX_DISPLAY_PROGRESS -
					PROVIDER_TRAINING_BASE_PROGRESS)
	);

	return Math.max(progressPct, softProgressPct);
}

export function getPersonLoraTrainingProgressPct(
	training: PersonLoraTrainingMeta | null,
	hasLora: boolean
) {
	const displayStatus = getPersonLoraTrainingDisplayStatus(training, hasLora);
	if (!displayStatus) {
		return 0;
	}

	const progressPct =
		typeof training?.progressPct === "number"
			? clampProgressPct(training.progressPct)
			: PERSON_LORA_FALLBACK_PROGRESS[displayStatus];

	return getProviderTrainingSoftProgressPct(training, progressPct);
}

export function getPersonLoraTrainingPhaseLabel(
	training: PersonLoraTrainingMeta | null,
	hasLora: boolean
) {
	const displayStatus = getPersonLoraTrainingDisplayStatus(training, hasLora);

	switch (training?.phase) {
		case "generating-references":
			return "Generating reference set";
		case "uploading-dataset":
			return "Packing and uploading dataset";
		case "starting-training":
			return "Submitting trainer job";
		case "polling-training":
			return "Training LoRA weights";
		case "publishing-lora":
			return "Publishing weights";
		case "cancelled":
			return "Pipeline cancelled";
		case "ready":
			return "Weights ready";
		case "failed":
			return "Training failed";
		default:
			switch (displayStatus) {
				case "queued":
					return "Waiting for worker";
				case "generating":
					return "Preparing dataset";
				case "training":
					return "Training LoRA weights";
				case "publishing":
					return "Publishing weights";
				case "ready":
					return "Weights ready";
				case "failed":
					return "Training failed";
				default:
					return "Idle";
			}
	}
}

export function getPersonLoraReferenceImageCount(
	training: PersonLoraTrainingMeta | null
) {
	if (typeof training?.referenceImageCount === "number") {
		return training.referenceImageCount;
	}
	return training?.referenceImageUrls?.length ?? 0;
}

export function getPersonLoraReferenceImageTarget(
	training: PersonLoraTrainingMeta | null
) {
	if (typeof training?.referenceImageTargetCount === "number") {
		return training.referenceImageTargetCount;
	}
	return DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT;
}

export interface CreatePersonInput {
	datasetUrl?: string;
	description?: string;
	loraUrl?: string;
	name: string;
	photoUrl?: string;
	referencePhotoUrl?: string;
	slug?: string;
	videoUrl?: string;
	voiceWavUrl?: string;
}

export interface UpdatePersonInput {
	datasetUrl?: null | string;
	description?: string;
	loraUrl?: null | string;
	metadata?: Record<string, unknown>;
	name?: string;
	photoUrl?: null | string;
	referencePhotoUrl?: string;
	slug?: string;
	videoUrl?: null | string;
	voiceWavUrl?: null | string;
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
