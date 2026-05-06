import { z } from "zod";

import type { RunpodHttpClient } from "../http/client";

export const SERVERLESS_RAW_STATUSES = [
	"IN_QUEUE",
	"IN_PROGRESS",
	"COMPLETED",
	"CANCELLED",
	"ERROR",
	"FAILED",
	"TIMED_OUT",
] as const;

export type ServerlessRawStatus = (typeof SERVERLESS_RAW_STATUSES)[number];

const submissionResponseSchema = z
	.object({
		id: z.string().min(1),
		status: z.string().optional(),
		queuePosition: z.number().int().nonnegative().optional(),
		queue_position: z.number().int().nonnegative().optional(),
	})
	.passthrough();

const statusResponseSchema = z
	.object({
		id: z.string().min(1).optional(),
		status: z.string().optional(),
		output: z.unknown().optional(),
		error: z.unknown().optional(),
		queuePosition: z.number().int().nonnegative().optional(),
		queue_position: z.number().int().nonnegative().optional(),
	})
	.passthrough();

export interface ServerlessSubmission {
	jobId: string;
	queuePosition: number | null;
	rawStatus: string;
}

export interface ServerlessJobStatus {
	error: unknown;
	jobId: string | null;
	output: unknown;
	queuePosition: number | null;
	rawStatus: string;
}

export interface ServerlessSubmitInput {
	endpointId: string;
	input: Record<string, unknown>;
	policy?: Record<string, unknown>;
}

/**
 * Низкоуровневый клиент серверлесс-API RunPod (`/v2/{endpointId}/...`).
 *
 * Возвращает «сырые» статусы — нормализация в `InferenceStatus` живёт в
 * `engine/serverless-engine.ts`, потому что именно engine знает про политику
 * (например, считать ли ошибку терминальной).
 */
export interface RunpodServerlessApi {
	cancel(input: { endpointId: string; jobId: string }): Promise<void>;
	getStatus(input: {
		endpointId: string;
		jobId: string;
	}): Promise<ServerlessJobStatus>;
	submit(input: ServerlessSubmitInput): Promise<ServerlessSubmission>;
}

export function createServerlessApi(
	http: RunpodHttpClient
): RunpodServerlessApi {
	return {
		async cancel({ endpointId, jobId }) {
			await http.post(
				`/${endpointId}/cancel/${jobId}`,
				undefined,
				"runpod serverless /cancel"
			);
		},
		async getStatus({ endpointId, jobId }) {
			const body = await http.get(
				`/${endpointId}/status/${jobId}`,
				"runpod serverless /status"
			);
			const parsed = statusResponseSchema.parse(body);
			return {
				error: parsed.error ?? null,
				jobId: parsed.id ?? null,
				output: parsed.output ?? null,
				queuePosition: parsed.queuePosition ?? parsed.queue_position ?? null,
				rawStatus: parsed.status ?? "IN_QUEUE",
			};
		},
		async submit({ endpointId, input, policy }) {
			const body: Record<string, unknown> = { input };
			if (policy) {
				body.policy = policy;
			}
			const response = await http.post(
				`/${endpointId}/run`,
				body,
				"runpod serverless /run"
			);
			const parsed = submissionResponseSchema.parse(response);
			return {
				jobId: parsed.id,
				queuePosition: parsed.queuePosition ?? parsed.queue_position ?? null,
				rawStatus: parsed.status ?? "IN_QUEUE",
			};
		},
	};
}
