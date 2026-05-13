import type { RunpodServerlessApi } from "../api/serverless";
import type { ServerlessWorkflow } from "../workflow/definition";
import type { Engine, EngineJob, EngineSubmission } from "./engine";
import { normalizeServerlessStatus } from "./status";

const TERMINAL_PROGRESS_PCT = 100;

interface ServerlessEngineOptions<TInput, TOutput> {
	api: RunpodServerlessApi;
	workflow: ServerlessWorkflow<TInput, TOutput>;
}

/**
 * Движок поверх RunPod /v2 queue. Отвечает за:
 *
 * - валидацию input через `workflow.inputSchema`,
 * - сборку payload и опциональной policy,
 * - нормализацию статусов,
 * - конвертацию `base64` в data URL (Fooocus-style выходы),
 * - извлечение текста ошибки из `output.error` или поля `error`,
 * - вызов `workflow.parseOutput` на success.
 */
export function createServerlessEngine<TInput, TOutput>(
	options: ServerlessEngineOptions<TInput, TOutput>
): Engine<TInput, TOutput> {
	const { api, workflow } = options;

	return {
		async cancel(jobId) {
			await api.cancel({ endpointId: workflow.endpointId, jobId });
		},

		async getStatus(jobId) {
			const status = await api.getStatus({
				endpointId: workflow.endpointId,
				jobId,
			});
			const baseStatus = normalizeServerlessStatus(status.rawStatus);
			const hasError = status.error !== null && status.error !== undefined;
			const finalStatus = hasError ? "failed" : baseStatus;
			const errorSummary =
				finalStatus === "failed"
					? extractErrorSummary(status.error, status.output)
					: null;

			let output: TOutput | null = null;
			if (finalStatus === "succeeded") {
				const enriched = enrichBase64Output(status.output);
				output = workflow.parseOutput(enriched);
			}

			return {
				errorSummary,
				jobId,
				output,
				progressPct: finalStatus === "succeeded" ? TERMINAL_PROGRESS_PCT : null,
				queuePosition: status.queuePosition,
				status: finalStatus,
			};
		},

		async submit(input, _options): Promise<EngineSubmission> {
			// serverless engine doesn't allocate volumes itself, so stickyKey is
			// accepted (for a uniform Engine contract) but ignored here.
			const parsed = workflow.inputSchema.parse(input);
			const submission = await api.submit({
				endpointId: workflow.endpointId,
				input: workflow.buildPayload(parsed),
				policy: workflow.policy as Record<string, unknown> | undefined,
			});
			return {
				jobId: submission.jobId,
				queuePosition: submission.queuePosition,
				status: normalizeServerlessStatus(submission.rawStatus),
			};
		},
	} satisfies Engine<TInput, TOutput> & {
		getStatus(jobId: string): Promise<EngineJob & { output: TOutput | null }>;
	};
}

function extractErrorSummary(error: unknown, output: unknown): string {
	const direct = stringifyError(error);
	if (direct) {
		return direct;
	}
	if (output && typeof output === "object") {
		const message = (output as { error?: unknown; message?: unknown }).error;
		const fromMessage = stringifyError(message);
		if (fromMessage) {
			return fromMessage;
		}
		const top = (output as { message?: unknown }).message;
		const fromTop = stringifyError(top);
		if (fromTop) {
			return fromTop;
		}
	}
	return "RunPod serverless job failed without a message";
}

function stringifyError(value: unknown): string | null {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (value && typeof value === "object") {
		const message = (value as { message?: unknown }).message;
		if (typeof message === "string" && message.length > 0) {
			return message;
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
