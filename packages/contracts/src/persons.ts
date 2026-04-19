export type PersonGenerationMediaType = "image" | "video" | "audio";
export type PersonGenerationStatus = "ready" | "queued" | "failed";
export type PersonLoraTrainingStatus =
	| "queued"
	| "generating"
	| "awaiting-approval"
	| "training"
	| "publishing"
	| "ready"
	| "failed";

export const PERSON_LORA_ACTIVE_TRAINING_STATUSES = [
	"queued",
	"generating",
	"awaiting-approval",
	"training",
	"publishing",
] as const satisfies readonly PersonLoraTrainingStatus[];

export type ActivePersonLoraTrainingStatus =
	(typeof PERSON_LORA_ACTIVE_TRAINING_STATUSES)[number];

export const DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT = 20;

/**
 * Workflow keys, hardcoded inside the persons service for the avatar onboarding
 * pipeline. Exposed here so that admin tooling can surface them in the
 * settings page without depending on persons-internal modules.
 */
export const PERSONS_AVATAR_WORKFLOWS = {
	preview: "fal-flux2-turbo",
	refine: "fal-flux2-dev-edit",
} as const;

const PERSON_LORA_ACTIVE_TRAINING_STATUS_SET = new Set<string>(
	PERSON_LORA_ACTIVE_TRAINING_STATUSES
);

const PERSON_LORA_FALLBACK_PROGRESS: Record<PersonLoraTrainingStatus, number> =
	{
		"awaiting-approval": 60,
		failed: 100,
		generating: 32,
		publishing: 92,
		queued: 2,
		ready: 100,
		training: 76,
	};

export function isApprovablePersonLoraTrainingStatus(
	status: string | null | undefined
): boolean {
	return status === "awaiting-approval";
}

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
		case "refilling-references":
			return "Regenerating rejected photos";
		case "awaiting-approval":
			return "Review dataset before training";
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
				case "awaiting-approval":
					return "Review dataset before training";
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

export type PersonLoraStageId = "queued" | "dataset" | "review" | "training";
export type PersonLoraStageState = "pending" | "active" | "done" | "failed";

export interface PersonLoraStageItem {
	detail: string | null;
	id: PersonLoraStageId;
	label: string;
	progressPct: number;
	state: PersonLoraStageState;
}

const PERSON_LORA_STAGE_ORDER: readonly PersonLoraStageId[] = [
	"queued",
	"dataset",
	"review",
	"training",
];

// `publishing` and `ready` both collapse onto the Training stage: publishing
// keeps it active (with a "publishing weights" detail), and ready marks the
// whole pipeline as `done` via the `isReady` shortcut in `buildStageState`.
const PERSON_LORA_STATUS_TO_STAGE_INDEX: Record<
	PersonLoraTrainingStatus | "ready",
	number
> = {
	"awaiting-approval": 2,
	failed: 3,
	generating: 1,
	publishing: 3,
	queued: 0,
	ready: 3,
	training: 3,
};

const PERSON_LORA_FAILED_STAGE_FROM_PHASE: Record<string, PersonLoraStageId> = {
	"awaiting-approval": "review",
	"generating-references": "dataset",
	"publishing-lora": "training",
	"polling-training": "training",
	"refilling-references": "dataset",
	"starting-training": "training",
	"uploading-dataset": "review",
};

function buildStageState(input: {
	currentIdx: number;
	failedStageId: PersonLoraStageId | null;
	isFailed: boolean;
	isReady: boolean;
	stageId: PersonLoraStageId;
}): PersonLoraStageState {
	const { currentIdx, failedStageId, isFailed, isReady, stageId } = input;
	// `ready` is a terminal status: every stage block must be fully filled,
	// otherwise the trailing "Ready" block would render as "active 30%" even
	// though the LoRA is already published and the user can use it.
	if (isReady) {
		return "done";
	}
	if (failedStageId === stageId) {
		return "failed";
	}
	const stageIdx = PERSON_LORA_STAGE_ORDER.indexOf(stageId);
	if (isFailed) {
		const failedIdx = PERSON_LORA_STAGE_ORDER.indexOf(
			failedStageId ?? "training"
		);
		return stageIdx < failedIdx ? "done" : "pending";
	}
	if (stageIdx < currentIdx) {
		return "done";
	}
	if (stageIdx === currentIdx) {
		return "active";
	}
	return "pending";
}

function progressForStageState(
	state: PersonLoraStageState,
	activeProgress: number
) {
	if (state === "done") {
		return 100;
	}
	if (state === "active" || state === "failed") {
		return activeProgress;
	}
	return 0;
}

function formatElapsedDuration(elapsedMs: number): string | null {
	if (!(Number.isFinite(elapsedMs) && elapsedMs > 0)) {
		return null;
	}
	const totalSeconds = Math.floor(elapsedMs / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	if (minutes < 60) {
		const seconds = totalSeconds % 60;
		return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const remMinutes = minutes % 60;
	return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function joinDetailParts(parts: ReadonlyArray<string | null>): string | null {
	const filtered = parts.filter(
		(part): part is string => typeof part === "string" && part.length > 0
	);
	return filtered.length > 0 ? filtered.join(" · ") : null;
}

function getTrainingActiveDetail(input: {
	effectiveStatus: PersonLoraTrainingStatus | "ready";
	elapsedLabel: string | null;
	progressPct: number;
	provider: string | null;
	providerStatus: string | null | undefined;
	trainingSteps: number | null;
}): string {
	const {
		effectiveStatus,
		elapsedLabel,
		progressPct,
		provider,
		providerStatus,
		trainingSteps,
	} = input;

	if (effectiveStatus === "publishing") {
		return (
			joinDetailParts(["publishing weights", elapsedLabel, provider]) ??
			"publishing weights"
		);
	}

	const stepsLabel = (() => {
		if (!trainingSteps) {
			return null;
		}
		const estimatedSteps = Math.min(
			trainingSteps,
			Math.max(0, Math.round((progressPct / 100) * trainingSteps))
		);
		return `~${estimatedSteps}/${trainingSteps} steps`;
	})();

	const statusLabel = providerStatus ? providerStatus.toLowerCase() : null;

	return (
		joinDetailParts([stepsLabel, elapsedLabel, statusLabel, provider]) ??
		"training in progress"
	);
}

function getTrainingStageDetail(input: {
	effectiveStatus: PersonLoraTrainingStatus | "ready";
	elapsedMs: number;
	progressPct: number;
	provider: string | null;
	providerStatus: string | null | undefined;
	state: PersonLoraStageState;
	trainingSteps: number | null;
}): string | null {
	const {
		effectiveStatus,
		elapsedMs,
		progressPct,
		provider,
		providerStatus,
		state,
		trainingSteps,
	} = input;

	const elapsedLabel = formatElapsedDuration(elapsedMs);

	if (state === "done") {
		const stepsLabel = trainingSteps
			? `${trainingSteps}/${trainingSteps} steps`
			: null;
		return (
			joinDetailParts([stepsLabel, elapsedLabel, "weights ready"]) ??
			"weights ready"
		);
	}
	if (state === "failed") {
		const stepsLabel = trainingSteps ? `target ${trainingSteps} steps` : null;
		return joinDetailParts([
			stepsLabel,
			elapsedLabel ? `after ${elapsedLabel}` : null,
		]);
	}
	if (state !== "active") {
		return null;
	}
	return getTrainingActiveDetail({
		effectiveStatus,
		elapsedLabel,
		progressPct,
		provider,
		providerStatus,
		trainingSteps,
	});
}

/**
 * Compute per-stage progress for the LoRA training pipeline.
 *
 * The pipeline is rendered as four sequential blocks
 * (Queued → Dataset → Review → Training), each acting as its own progress
 * bar. fal/z-image-trainer does not expose a current-step counter via the
 * queue status endpoint, so the "Training" block estimates step progress
 * from elapsed time relative to a 45-minute soft window — same heuristic
 * used by `getPersonLoraTrainingProgressPct`, but normalized into the
 * local [0, 100] range of the block. The terminal `publishing` and `ready`
 * statuses both fold onto the Training block (active@95% with
 * "publishing weights" detail, then `done` with the steps/elapsed summary
 * once weights are published).
 */
export function getPersonLoraTrainingStages(input: {
	hasLora: boolean;
	training: PersonLoraTrainingMeta | null;
}): PersonLoraStageItem[] {
	const { hasLora, training } = input;
	const effectiveStatus =
		getPersonLoraTrainingDisplayStatus(training, hasLora) ?? "queued";
	const referenceImageCount = getPersonLoraReferenceImageCount(training);
	const referenceImageTarget = getPersonLoraReferenceImageTarget(training);

	const isFailed = effectiveStatus === "failed";
	const isReady = effectiveStatus === "ready";
	const failedStageId: PersonLoraStageId | null = isFailed
		? (PERSON_LORA_FAILED_STAGE_FROM_PHASE[training?.phase ?? ""] ?? "training")
		: null;
	const currentIdx = PERSON_LORA_STATUS_TO_STAGE_INDEX[effectiveStatus] ?? 0;

	const trainingSteps =
		typeof training?.trainingSteps === "number" && training.trainingSteps > 0
			? training.trainingSteps
			: null;
	const elapsedMs =
		typeof training?.trainingElapsedMs === "number" &&
		Number.isFinite(training.trainingElapsedMs)
			? Math.max(0, training.trainingElapsedMs)
			: 0;
	// Provider doesn't expose a step counter via queue status, so we estimate
	// progress from elapsed time relative to a 45-minute soft window (same
	// heuristic as `getPersonLoraTrainingProgressPct`). When the run flips to
	// `publishing` we bump the bar to 95% so the operator gets visual confirmation
	// the trainer finished and the upload is in flight.
	const trainingTimeProgress = clampProgressPct(
		Math.max(
			5,
			Math.min(1, elapsedMs / PROVIDER_TRAINING_SOFT_PROGRESS_WINDOW_MS) * 100
		)
	);
	const trainingActiveProgress =
		effectiveStatus === "publishing"
			? Math.max(95, trainingTimeProgress)
			: trainingTimeProgress;

	const datasetRefsLabel =
		referenceImageTarget > 0
			? `${referenceImageCount}/${referenceImageTarget} refs`
			: `${referenceImageCount} refs`;

	const datasetRatio =
		referenceImageTarget > 0
			? Math.min(1, referenceImageCount / referenceImageTarget)
			: 0;
	const datasetActiveProgress = clampProgressPct(
		Math.max(5, datasetRatio * 100)
	);

	const queuedState = buildStageState({
		currentIdx,
		failedStageId,
		isFailed,
		isReady,
		stageId: "queued",
	});
	const datasetState = buildStageState({
		currentIdx,
		failedStageId,
		isFailed,
		isReady,
		stageId: "dataset",
	});
	const reviewState = buildStageState({
		currentIdx,
		failedStageId,
		isFailed,
		isReady,
		stageId: "review",
	});
	const trainingState = buildStageState({
		currentIdx,
		failedStageId,
		isFailed,
		isReady,
		stageId: "training",
	});

	const trainingProgressPct = progressForStageState(
		trainingState,
		trainingActiveProgress
	);
	const datasetShowDetail =
		datasetState === "active" ||
		datasetState === "done" ||
		datasetState === "failed";
	let reviewDetail: string | null = null;
	if (reviewState === "active") {
		reviewDetail = "waiting for approval";
	} else if (reviewState === "done") {
		reviewDetail = "approved";
	}
	const provider =
		typeof training?.provider === "string" && training.provider.length > 0
			? training.provider
			: null;

	return [
		{
			detail: queuedState === "active" ? "waiting for worker" : null,
			id: "queued",
			label: "Queued",
			progressPct: progressForStageState(queuedState, 60),
			state: queuedState,
		},
		{
			detail: datasetShowDetail ? datasetRefsLabel : null,
			id: "dataset",
			label: "Dataset",
			progressPct: progressForStageState(datasetState, datasetActiveProgress),
			state: datasetState,
		},
		{
			detail: reviewDetail,
			id: "review",
			label: "Review",
			progressPct: progressForStageState(reviewState, 50),
			state: reviewState,
		},
		{
			detail: getTrainingStageDetail({
				effectiveStatus,
				elapsedMs,
				progressPct: trainingProgressPct,
				provider,
				providerStatus: training?.providerStatus,
				state: trainingState,
				trainingSteps,
			}),
			id: "training",
			label: "Training",
			progressPct: trainingProgressPct,
			state: trainingState,
		},
	];
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
