import type { ServerlessRawStatus } from "../api/serverless";

export type InferenceStatus = "queued" | "running" | "succeeded" | "failed";

export const TERMINAL_STATUSES: ReadonlySet<InferenceStatus> = new Set([
	"succeeded",
	"failed",
]);

const SERVERLESS_STATUS_MAP: Record<ServerlessRawStatus, InferenceStatus> = {
	CANCELLED: "failed",
	COMPLETED: "succeeded",
	ERROR: "failed",
	FAILED: "failed",
	IN_PROGRESS: "running",
	// RunPod undocumented: некоторые SDK-handler'ы возвращают `RUNNING` в
	// `/status` response вместо `IN_PROGRESS`. Маппим в тот же `running`.
	RUNNING: "running",
	IN_QUEUE: "queued",
	TIMED_OUT: "failed",
};

export function normalizeServerlessStatus(rawStatus: string): InferenceStatus {
	const normalized = SERVERLESS_STATUS_MAP[rawStatus as ServerlessRawStatus];
	if (!normalized) {
		throw new Error(`Unsupported RunPod serverless status: ${rawStatus}`);
	}
	return normalized;
}
