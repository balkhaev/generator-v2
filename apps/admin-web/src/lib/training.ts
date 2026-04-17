import {
	getPersonLoraReferenceImageCount,
	getPersonLoraTrainingDisplayStatus,
	getPersonLoraTrainingPhaseLabel,
	getPersonLoraTrainingProgressPct,
	isActivePersonLoraTrainingStatus,
	type PersonLoraTrainingMeta,
	type PersonLoraTrainingStatus,
} from "@generator/contracts/persons";

export function isActiveTrainingStatus(
	status: PersonLoraTrainingStatus | string | null | undefined
) {
	return isActivePersonLoraTrainingStatus(status);
}

export function getDisplayTrainingStatus(
	training: PersonLoraTrainingMeta | null,
	hasLora: boolean
) {
	return getPersonLoraTrainingDisplayStatus(training, hasLora);
}

export function getDerivedProgressPct(
	training: PersonLoraTrainingMeta | null,
	hasLora = false
) {
	return getPersonLoraTrainingProgressPct(training, hasLora);
}

export function getReferenceImageCount(
	training: PersonLoraTrainingMeta | null
) {
	return getPersonLoraReferenceImageCount(training);
}

export function getTrainingPhaseLabel(
	training: PersonLoraTrainingMeta | null,
	hasLora: boolean
) {
	return getPersonLoraTrainingPhaseLabel(training, hasLora);
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
