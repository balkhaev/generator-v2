export const PERSON_LORA_ACTIVE_TRAINING_STATUSES = [
	"queued",
	"generating",
	"awaiting-approval",
	"training",
	"publishing",
];
export const DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT = 20;
/**
 * Workflow keys, hardcoded inside the persons service for the avatar onboarding
 * pipeline. Exposed here so that admin tooling can surface them in the
 * settings page without depending on persons-internal modules.
 */
export const PERSONS_AVATAR_WORKFLOWS = {
	preview: "fal-flux2-turbo",
	refine: "fal-flux2-dev-edit",
};
const PERSON_LORA_ACTIVE_TRAINING_STATUS_SET = new Set(
	PERSON_LORA_ACTIVE_TRAINING_STATUSES
);
const PERSON_LORA_FALLBACK_PROGRESS = {
	"awaiting-approval": 60,
	failed: 100,
	generating: 32,
	publishing: 92,
	queued: 2,
	ready: 100,
	training: 76,
};
export function isApprovablePersonLoraTrainingStatus(status) {
	return status === "awaiting-approval";
}
const PROVIDER_TRAINING_BASE_PROGRESS = 76;
const PROVIDER_TRAINING_MAX_DISPLAY_PROGRESS = 89;
const PROVIDER_TRAINING_SOFT_PROGRESS_WINDOW_MS = 45 * 60 * 1000;
export function clampProgressPct(value) {
	return Math.max(0, Math.min(100, Math.round(value)));
}
export function isActivePersonLoraTrainingStatus(status) {
	return (
		typeof status === "string" &&
		PERSON_LORA_ACTIVE_TRAINING_STATUS_SET.has(status)
	);
}
export function readPersonLoraTrainingMeta(person) {
	const training = person.metadata?.training;
	if (training && typeof training === "object" && !Array.isArray(training)) {
		return training;
	}
	return null;
}
export function getPersonLoraTrainingDisplayStatus(training, hasLora) {
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
function getProviderTrainingSoftProgressPct(training, progressPct) {
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
export function getPersonLoraTrainingProgressPct(training, hasLora) {
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
export function getPersonLoraTrainingPhaseLabel(training, hasLora) {
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
export function getPersonLoraReferenceImageCount(training) {
	if (typeof training?.referenceImageCount === "number") {
		return training.referenceImageCount;
	}
	return training?.referenceImageUrls?.length ?? 0;
}
export function getPersonLoraReferenceImageTarget(training) {
	if (typeof training?.referenceImageTargetCount === "number") {
		return training.referenceImageTargetCount;
	}
	return DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT;
}
const PERSON_LORA_STAGE_ORDER = [
	"queued",
	"dataset",
	"review",
	"training",
	"ready",
];
const PERSON_LORA_STATUS_TO_STAGE_INDEX = {
	"awaiting-approval": 2,
	failed: 4,
	generating: 1,
	publishing: 3,
	queued: 0,
	ready: 4,
	training: 3,
};
const PERSON_LORA_FAILED_STAGE_FROM_PHASE = {
	"awaiting-approval": "review",
	"generating-references": "dataset",
	"publishing-lora": "ready",
	"polling-training": "training",
	"refilling-references": "dataset",
	"starting-training": "training",
	"uploading-dataset": "review",
};
function buildStageState(input) {
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
function progressForStageState(state, activeProgress) {
	if (state === "done") {
		return 100;
	}
	if (state === "active" || state === "failed") {
		return activeProgress;
	}
	return 0;
}
function getTrainingStageDetail(input) {
	const { progressPct, providerStatus, state, trainingSteps } = input;
	if (state === "done" && trainingSteps) {
		return `${trainingSteps}/${trainingSteps} steps`;
	}
	if (state === "failed" && trainingSteps) {
		return `target ${trainingSteps} steps`;
	}
	if (state !== "active") {
		return null;
	}
	if (trainingSteps) {
		const estimatedSteps = Math.min(
			trainingSteps,
			Math.round((progressPct / 100) * trainingSteps)
		);
		return `~${estimatedSteps}/${trainingSteps} steps`;
	}
	if (providerStatus) {
		return providerStatus.toLowerCase();
	}
	return null;
}
function getReadyStageDetail(input) {
	if (input.state === "done") {
		return "weights ready";
	}
	if (input.state === "active") {
		return input.effectiveStatus === "publishing"
			? "publishing weights"
			: "finalizing";
	}
	return null;
}
/**
 * Compute per-stage progress for the LoRA training pipeline.
 *
 * The pipeline is rendered as four sequential blocks (Queued → Dataset →
 * Training → Ready), each acting as its own progress bar. fal/z-image-trainer
 * does not expose a current-step counter via the queue status endpoint, so the
 * "Training" block estimates step progress from elapsed time relative to a
 * 45-minute soft window — same heuristic used by `getPersonLoraTrainingProgressPct`,
 * but normalized into the local [0, 100] range of the block.
 */
export function getPersonLoraTrainingStages(input) {
	const { hasLora, training } = input;
	const effectiveStatus =
		getPersonLoraTrainingDisplayStatus(training, hasLora) ?? "queued";
	const referenceImageCount = getPersonLoraReferenceImageCount(training);
	const referenceImageTarget = getPersonLoraReferenceImageTarget(training);
	const isFailed = effectiveStatus === "failed";
	const isReady = effectiveStatus === "ready";
	const failedStageId = isFailed
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
	const trainingActiveProgress = clampProgressPct(
		Math.max(
			5,
			Math.min(1, elapsedMs / PROVIDER_TRAINING_SOFT_PROGRESS_WINDOW_MS) * 100
		)
	);
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
	const readyState = buildStageState({
		currentIdx,
		failedStageId,
		isFailed,
		isReady,
		stageId: "ready",
	});
	const trainingProgressPct = progressForStageState(
		trainingState,
		trainingActiveProgress
	);
	const readyActiveProgress = effectiveStatus === "publishing" ? 60 : 30;
	const datasetShowDetail =
		datasetState === "active" ||
		datasetState === "done" ||
		datasetState === "failed";
	let reviewDetail = null;
	if (reviewState === "active") {
		reviewDetail = "waiting for approval";
	} else if (reviewState === "done") {
		reviewDetail = "approved";
	}
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
				progressPct: trainingProgressPct,
				providerStatus: training?.providerStatus,
				state: trainingState,
				trainingSteps,
			}),
			id: "training",
			label: "Training",
			progressPct: trainingProgressPct,
			state: trainingState,
		},
		{
			detail: getReadyStageDetail({
				effectiveStatus,
				state: readyState,
			}),
			id: "ready",
			label: "Ready",
			progressPct: progressForStageState(readyState, readyActiveProgress),
			state: readyState,
		},
	];
}
