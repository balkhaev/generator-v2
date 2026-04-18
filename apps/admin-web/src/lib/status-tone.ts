import type { RunStatus } from "@generator/contracts/generator";
import type { PersonLoraTrainingStatus } from "@generator/contracts/persons";
import type { StatusBadgeTone } from "@generator/ui/components/status-badge";

export function runStatusTone(status: RunStatus): StatusBadgeTone {
	switch (status) {
		case "succeeded":
			return "success";
		case "failed":
			return "danger";
		case "running":
			return "warning";
		case "queued":
			return "info";
		default:
			return "neutral";
	}
}

export function trainingStatusTone(
	status: PersonLoraTrainingStatus | "ready" | undefined
): StatusBadgeTone {
	switch (status) {
		case "ready":
			return "success";
		case "failed":
			return "danger";
		case "training":
			return "accent";
		case "generating":
			return "warning";
		case "publishing":
			return "info";
		case "queued":
			return "info";
		default:
			return "neutral";
	}
}
