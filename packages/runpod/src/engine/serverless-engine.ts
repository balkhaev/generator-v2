import type {
	RunpodServerlessApi,
	ServerlessJobStatus,
	ServerlessSubmission,
} from "../api/serverless";
import type { RunpodPolicy, ServerlessWorkflow } from "../workflow/definition";
import type { Engine, EngineJob, EngineSubmission } from "./engine";
import { normalizeServerlessStatus } from "./status";

const TERMINAL_PROGRESS_PCT = 100;
const DEFAULT_RUN_SYNC_WAIT_MS = 90_000;

interface ServerlessEngineOptions<TInput, TOutput> {
	api: RunpodServerlessApi;
	logger?: Pick<Console, "info" | "warn">;
	/** Дополнительный наблюдатель за подаваемыми/завершёнными jobs (для метрик). */
	observer?: ServerlessEngineObserver;
	workflow: ServerlessWorkflow<TInput, TOutput>;
}

export interface ServerlessEngineObserver {
	onCompleted?(event: ServerlessCompletedEvent): void;
	onSubmitted?(event: ServerlessSubmittedEvent): void;
}

export interface ServerlessSubmittedEvent {
	endpointId: string;
	jobId: string;
	mode: "run" | "runsync";
	rawStatus: string;
	workflowId: string;
}

export interface ServerlessCompletedEvent {
	delayTimeMs: number | null;
	endpointId: string;
	executionTimeMs: number | null;
	jobId: string;
	retries: number | null;
	status: "succeeded" | "failed";
	workflowId: string;
}

type StatusLike = ServerlessJobStatus | ServerlessSubmission;

/**
 * Движок поверх RunPod /v2 queue. Отвечает за:
 *
 * - валидацию input через `workflow.inputSchema`,
 * - сборку payload и default-policy merging,
 * - опциональный `/runsync` для коротких workflow (один round-trip),
 * - нормализацию статусов (включая `RUNNING` который API иногда отдаёт
 *   вместо `IN_PROGRESS`),
 * - конвертацию `base64` в data URL (Fooocus-style выходы),
 * - извлечение текста ошибки из разнообразных handler-форматов
 *   (`output.error`, `output.error_message`, `output.errorMessage`,
 *   `output.traceback`, `error.{message,detail}`),
 * - вызов `workflow.parseOutput` на success,
 * - снимает `delayTime` / `executionTime` и пушит в observer (для метрик
 *   cold-start vs throughput).
 */
export function createServerlessEngine<TInput, TOutput>(
	options: ServerlessEngineOptions<TInput, TOutput>
): Engine<TInput, TOutput> {
	const { api, logger, observer, workflow } = options;

	const mergedPolicy = mergePolicy(workflow.defaultPolicy, workflow.policy);

	const emitCompleted = (
		status: StatusLike,
		fallbackJobId: string,
		finalStatus: "succeeded" | "failed"
	): void => {
		observer?.onCompleted?.({
			delayTimeMs: status.delayTimeMs,
			endpointId: workflow.endpointId,
			executionTimeMs: status.executionTimeMs,
			jobId: fallbackJobId,
			retries: extractRetries(status),
			status: finalStatus,
			workflowId: workflow.id,
		});
	};

	const handleFailed = (
		jobId: string,
		status: StatusLike,
		fallbackJobId: string
	): EngineJob & { output: null } => {
		emitCompleted(status, fallbackJobId, "failed");
		return {
			errorSummary: extractErrorSummary(status.error, status.output),
			jobId,
			output: null,
			progressPct: null,
			queuePosition: status.queuePosition,
			status: "failed",
		};
	};

	const handleSucceeded = (
		jobId: string,
		status: StatusLike,
		fallbackJobId: string
	): EngineJob & { output: TOutput | null } => {
		const enriched = enrichBase64Output(status.output);
		let parsed: TOutput;
		try {
			parsed = workflow.parseOutput(enriched);
		} catch (error) {
			logger?.warn?.("runpod-serverless.parseOutput-failed", {
				endpointId: workflow.endpointId,
				jobId: fallbackJobId,
				message: error instanceof Error ? error.message : String(error),
				workflowId: workflow.id,
			});
			emitCompleted(status, fallbackJobId, "failed");
			return {
				errorSummary: `Failed to parse worker output: ${
					error instanceof Error ? error.message : String(error)
				}`,
				jobId,
				output: null,
				progressPct: null,
				queuePosition: status.queuePosition,
				status: "failed",
			};
		}
		emitCompleted(status, fallbackJobId, "succeeded");
		return {
			errorSummary: null,
			jobId,
			output: parsed,
			progressPct: TERMINAL_PROGRESS_PCT,
			queuePosition: status.queuePosition,
			status: "succeeded",
		};
	};

	const buildStatusOutput = (
		jobId: string,
		status: StatusLike,
		fallbackJobId: string
	): EngineJob & { output: TOutput | null } => {
		const baseStatus = normalizeServerlessStatus(status.rawStatus);
		const finalStatus = computeFinalStatus(status, baseStatus);
		if (finalStatus === "failed") {
			return handleFailed(jobId, status, fallbackJobId);
		}
		if (finalStatus === "succeeded") {
			return handleSucceeded(jobId, status, fallbackJobId);
		}
		return {
			errorSummary: null,
			jobId,
			output: null,
			progressPct: null,
			queuePosition: status.queuePosition,
			status: finalStatus,
		};
	};

	return {
		async cancel(jobId) {
			await api.cancel({ endpointId: workflow.endpointId, jobId });
		},

		async getStatus(jobId) {
			const status = await api.getStatus({
				endpointId: workflow.endpointId,
				jobId,
			});
			return buildStatusOutput(jobId, status, jobId);
		},

		async submit(input, options): Promise<EngineSubmission> {
			// stickyKey is reused as opaque requestId for the workflow's
			// buildPayload context: pod engine maps it to a network volume,
			// serverless engine just forwards it so payload builders can stamp
			// stable filenames (`req-{id}.png`) for inline image uploads.
			const parsed = workflow.inputSchema.parse(input);
			const requestId = options?.stickyKey ?? crypto.randomUUID();
			const payload = await workflow.buildPayload(parsed, { requestId });
			const policy = mergedPolicy
				? (mergedPolicy as Record<string, unknown>)
				: undefined;

			if (workflow.runSync?.enabled) {
				const waitMs = workflow.runSync.waitMs ?? DEFAULT_RUN_SYNC_WAIT_MS;
				const submission = await api.runSync({
					endpointId: workflow.endpointId,
					input: payload,
					policy,
					waitMs,
					webhook: workflow.webhookUrl,
				});
				observer?.onSubmitted?.({
					endpointId: workflow.endpointId,
					jobId: submission.jobId,
					mode: "runsync",
					rawStatus: submission.rawStatus,
					workflowId: workflow.id,
				});
				// runSync уже возвращает терминальный статус если успел в waitMs;
				// иначе клиент должен дополнительно поллить через getStatus.
				return {
					jobId: submission.jobId,
					queuePosition: submission.queuePosition,
					rawProviderJobReference: submission.jobId,
					status: normalizeServerlessStatus(submission.rawStatus),
				};
			}

			const submission = await api.submit({
				endpointId: workflow.endpointId,
				input: payload,
				policy,
				webhook: workflow.webhookUrl,
			});
			observer?.onSubmitted?.({
				endpointId: workflow.endpointId,
				jobId: submission.jobId,
				mode: "run",
				rawStatus: submission.rawStatus,
				workflowId: workflow.id,
			});
			return {
				jobId: submission.jobId,
				queuePosition: submission.queuePosition,
				rawProviderJobReference: submission.jobId,
				status: normalizeServerlessStatus(submission.rawStatus),
			};
		},
	} satisfies Engine<TInput, TOutput> & {
		getStatus(jobId: string): Promise<EngineJob & { output: TOutput | null }>;
	};
}

function computeFinalStatus(
	status: StatusLike,
	baseStatus: ReturnType<typeof normalizeServerlessStatus>
): ReturnType<typeof normalizeServerlessStatus> {
	const hasTopLevelError = status.error !== null && status.error !== undefined;
	const hasEmbedded =
		!hasTopLevelError &&
		status.output !== null &&
		hasEmbeddedError(status.output);
	return hasTopLevelError || hasEmbedded ? "failed" : baseStatus;
}

function extractRetries(status: StatusLike): number | null {
	if ("retries" in status && typeof status.retries === "number") {
		return status.retries;
	}
	return null;
}

function mergePolicy(
	primary: RunpodPolicy | undefined,
	fallback: RunpodPolicy | undefined
): RunpodPolicy | undefined {
	if (!(primary || fallback)) {
		return;
	}
	return {
		executionTimeout: primary?.executionTimeout ?? fallback?.executionTimeout,
		lowPriority: primary?.lowPriority ?? fallback?.lowPriority,
		ttl: primary?.ttl ?? fallback?.ttl,
	};
}

const EMBEDDED_ERROR_KEYS = [
	"error",
	"error_message",
	"errorMessage",
	"traceback",
	"errorTraceback",
] as const;

function hasEmbeddedError(output: unknown): boolean {
	if (!output || typeof output !== "object") {
		return false;
	}
	const record = output as Record<string, unknown>;
	for (const key of EMBEDDED_ERROR_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return true;
		}
		if (value && typeof value === "object") {
			return true;
		}
	}
	return false;
}

const OUTPUT_ERROR_KEYS = [
	"error",
	"error_message",
	"errorMessage",
	"message",
	"traceback",
	"errorTraceback",
	"detail",
] as const;

function extractErrorSummary(error: unknown, output: unknown): string {
	const direct = stringifyError(error);
	if (direct) {
		return direct;
	}
	if (output && typeof output === "object") {
		const record = output as Record<string, unknown>;
		for (const key of OUTPUT_ERROR_KEYS) {
			const value = record[key];
			const fromKey = stringifyError(value);
			if (fromKey) {
				return fromKey;
			}
		}
	}
	return "RunPod serverless job failed without a message";
}

const NESTED_ERROR_KEYS = [
	"message",
	"detail",
	"error",
	"errorMessage",
] as const;

function stringifyError(value: unknown): string | null {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key of NESTED_ERROR_KEYS) {
			const nested = record[key];
			if (typeof nested === "string" && nested.length > 0) {
				return nested;
			}
		}
		try {
			return JSON.stringify(value);
		} catch {
			return null;
		}
	}
	return null;
}

function enrichBase64Output(output: unknown): unknown {
	if (Array.isArray(output)) {
		return output.map(enrichBase64Output);
	}
	if (!output || typeof output !== "object") {
		return output;
	}
	const record = output as Record<string, unknown>;
	const enriched: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		enriched[key] = enrichBase64Output(value);
	}
	const base64 = record.base64;
	if (
		typeof base64 === "string" &&
		base64.length > 0 &&
		!base64.startsWith("data:")
	) {
		enriched.dataUrl = `data:image/png;base64,${base64}`;
	}
	return enriched;
}
