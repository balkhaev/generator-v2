import type { RunpodService } from "@generator/runpod";
import { ENDPOINT_ID_PREFIX, isNoCapacityError } from "@generator/runpod";

import {
	type InferenceClient,
	type InferenceJob,
	type InferenceSubmission,
	RetryableInferenceError,
} from "./inference";

// 90s — long enough for RunPod to release some inventory after a burst, short
// enough that the user perceives "still queued" rather than "stuck". 20 min
// matches the typical wait between capacity-throttle cycles we observed.
const NO_CAPACITY_RETRY_DELAY_MS = 90 * 1000;
const NO_CAPACITY_RETRY_WINDOW_MS = 20 * 60 * 1000;

export const RUNPOD_WORKFLOW_PAYLOAD_KEY = "__runpodWorkflow";
export const RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY = "__runpodEndpoint";
export const RUNPOD_LEGACY_POD_PAYLOAD_KEY = "__runpodPod";

/**
 * Адаптер `RunpodService` в общий `InferenceClient` контракт.
 *
 * Поддерживает три формы payload:
 *
 * 1. Новый: `{ __runpodWorkflow: "fooocus-sdxl" | "ltx-2-3-video", ...input }`.
 * 2. Legacy serverless: `{ __runpodEndpoint: "fooocus-sdxl", ...input }` →
 *    маппится на workflow с тем же id.
 * 3. Legacy pod: `{ __runpodPod: "ltx-2-3-video", ...input }` →
 *    маппится на pod workflow с тем же id.
 *
 * `endpointId` в БД может быть в трёх формах: `runpod:<workflowId>`,
 * `runpod:<rawEndpointId>` (legacy serverless), `runpod-pod:<workflowId>`
 * (legacy pod). Все три читаются `RunpodService` напрямую.
 */
export function createRunpodClient(service: RunpodService): InferenceClient {
	return {
		async cancel(jobId, endpointId): Promise<void> {
			if (!endpointId) {
				throw new Error("RunPod provider requires endpointId for cancellation");
			}
			await service.cancel({ endpointId, jobId });
		},

		async getStatus(jobId, endpointId): Promise<InferenceJob> {
			if (!endpointId) {
				throw new Error("RunPod provider requires endpointId for status check");
			}
			const job = await service.getStatus({ endpointId, jobId });
			return {
				endpointId: job.endpointId,
				errorSummary: job.errorSummary,
				jobId: job.jobId,
				output: job.output,
				progressPct: job.progressPct,
				queuePosition: job.queuePosition,
				status: job.status,
			};
		},

		async submit(payload, options): Promise<InferenceSubmission> {
			const { workflowId, input } = resolveSubmission(payload, service);
			let submission: Awaited<ReturnType<typeof service.submit>>;
			try {
				submission = await service.submit({
					input,
					stickyKey: options?.stickyKey,
					workflowId,
				});
			} catch (error) {
				if (isNoCapacityError(error)) {
					// All network volumes refused. This is the most common reason
					// jobs were getting markFailed prematurely — promote it to a
					// retryable signal so the worker re-queues with delay instead
					// of burning attempts via exponential backoff.
					throw new RetryableInferenceError(
						error instanceof Error ? error.message : String(error),
						{
							cause: error,
							delayMs: NO_CAPACITY_RETRY_DELAY_MS,
							maxWindowMs: NO_CAPACITY_RETRY_WINDOW_MS,
						}
					);
				}
				throw error;
			}
			return {
				endpointId: submission.endpointId,
				jobId: submission.jobId,
				queuePosition: submission.queuePosition,
				status: submission.status,
			};
		},
	};
}

/**
 * Эта функция вынесена отдельно: ей же пользуется `inference-router.ts`,
 * чтобы определить «это RunPod payload?» одним вызовом.
 */
export function isRunpodPayload(payload: Record<string, unknown>): boolean {
	return (
		RUNPOD_WORKFLOW_PAYLOAD_KEY in payload ||
		RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY in payload ||
		RUNPOD_LEGACY_POD_PAYLOAD_KEY in payload
	);
}

export function isRunpodEndpointId(endpointId: string | undefined): boolean {
	if (!endpointId) {
		return false;
	}
	return (
		endpointId.startsWith(ENDPOINT_ID_PREFIX) ||
		endpointId.startsWith("runpod-pod:")
	);
}

function resolveSubmission(
	payload: Record<string, unknown>,
	service: RunpodService
): { input: Record<string, unknown>; workflowId: string } {
	const workflowId = readWorkflowId(payload, service);
	const input: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (
			key === RUNPOD_WORKFLOW_PAYLOAD_KEY ||
			key === RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY ||
			key === RUNPOD_LEGACY_POD_PAYLOAD_KEY
		) {
			continue;
		}
		input[key] = value;
	}
	return { input, workflowId };
}

function readWorkflowId(
	payload: Record<string, unknown>,
	service: RunpodService
): string {
	const explicit = payload[RUNPOD_WORKFLOW_PAYLOAD_KEY];
	if (typeof explicit === "string" && explicit.length > 0) {
		return explicit;
	}
	const legacyEndpoint = payload[RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY];
	if (typeof legacyEndpoint === "string" && legacyEndpoint.length > 0) {
		return resolveLegacyServerlessId(legacyEndpoint, service);
	}
	const legacyPod = payload[RUNPOD_LEGACY_POD_PAYLOAD_KEY];
	if (typeof legacyPod === "string" && legacyPod.length > 0) {
		return legacyPod;
	}
	throw new Error(
		`RunPod payload requires one of [${RUNPOD_WORKFLOW_PAYLOAD_KEY}, ${RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY}, ${RUNPOD_LEGACY_POD_PAYLOAD_KEY}]`
	);
}

function resolveLegacyServerlessId(
	candidate: string,
	service: RunpodService
): string {
	if (service.registry.has(candidate)) {
		return candidate;
	}
	for (const workflow of service.registry.list()) {
		if (workflow.mode === "serverless" && workflow.endpointId === candidate) {
			return workflow.id;
		}
	}
	throw new Error(
		`Legacy ${RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY}=${candidate} did not match any RunPod workflow`
	);
}
