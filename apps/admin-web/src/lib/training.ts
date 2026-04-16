import type {
	PersonLoraTrainingMeta,
	PersonLoraTrainingStatus,
} from "@generator/contracts/persons";

export function clampProgressPct(value: number) {
	return Math.max(0, Math.min(100, Math.round(value)));
}

export function isActiveTrainingStatus(
	status: PersonLoraTrainingStatus | undefined
) {
	return (
		status === "queued" ||
		status === "generating" ||
		status === "training" ||
		status === "publishing"
	);
}

export function getDerivedProgressPct(training: PersonLoraTrainingMeta | null) {
	if (typeof training?.progressPct === "number") {
		return clampProgressPct(training.progressPct);
	}
	switch (training?.status) {
		case "queued":
			return 2;
		case "generating":
			return 30;
		case "training":
			return 76;
		case "publishing":
			return 92;
		case "ready":
			return 100;
		case "failed":
			return 100;
		default:
			return 0;
	}
}

export function getReferenceImageCount(
	training: PersonLoraTrainingMeta | null
) {
	if (typeof training?.referenceImageCount === "number") {
		return training.referenceImageCount;
	}
	return training?.referenceImageUrls?.length ?? 0;
}

export function formatDurationMs(value: number | null | undefined) {
	if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
		return null;
	}
	if (value < 1000) {
		return `${value} ms`;
	}
	const totalSeconds = Math.round(value / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
