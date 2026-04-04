export const runStatuses = ["queued", "running", "succeeded", "failed"] as const;

export type RunStatus = (typeof runStatuses)[number];

const runStatusTransitions: Record<RunStatus, readonly RunStatus[]> = {
	queued: ["running", "failed"],
	running: ["succeeded", "failed"],
	succeeded: [],
	failed: [],
};

export function getAllowedNextRunStatuses(status: RunStatus) {
	return runStatusTransitions[status];
}

export function canTransitionRunStatus(from: RunStatus, to: RunStatus) {
	return runStatusTransitions[from].includes(to);
}

export function assertValidRunStatusTransition(from: RunStatus, to: RunStatus) {
	if (canTransitionRunStatus(from, to)) {
		return;
	}

	throw new Error(`Invalid run status transition: ${from} -> ${to}`);
}

export function transitionRunStatus(from: RunStatus, to: RunStatus) {
	assertValidRunStatusTransition(from, to);
	return to;
}
