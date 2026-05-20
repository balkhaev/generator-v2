import { z } from "zod";

import type { RunpodHttpClient } from "../http/client";

export const SERVERLESS_RAW_STATUSES = [
	"IN_QUEUE",
	"IN_PROGRESS",
	"RUNNING",
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
		// /runsync может вернуть терминальный output сразу — забираем оба поля
		output: z.unknown().optional(),
		error: z.unknown().optional(),
		delayTime: z.number().nonnegative().optional(),
		executionTime: z.number().nonnegative().optional(),
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
		delayTime: z.number().nonnegative().optional(),
		executionTime: z.number().nonnegative().optional(),
		retries: z.number().int().nonnegative().optional(),
	})
	.passthrough();

const healthResponseSchema = z
	.object({
		jobs: z
			.object({
				completed: z.number().int().nonnegative().optional(),
				failed: z.number().int().nonnegative().optional(),
				inProgress: z.number().int().nonnegative().optional(),
				inQueue: z.number().int().nonnegative().optional(),
				retried: z.number().int().nonnegative().optional(),
			})
			.passthrough()
			.optional(),
		workers: z
			.object({
				idle: z.number().int().nonnegative().optional(),
				initializing: z.number().int().nonnegative().optional(),
				ready: z.number().int().nonnegative().optional(),
				running: z.number().int().nonnegative().optional(),
				throttled: z.number().int().nonnegative().optional(),
				unhealthy: z.number().int().nonnegative().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

const purgeResponseSchema = z
	.object({
		removed: z.number().int().nonnegative().optional(),
		status: z.string().optional(),
	})
	.passthrough();

export interface ServerlessSubmission {
	delayTimeMs: number | null;
	error: unknown;
	executionTimeMs: number | null;
	jobId: string;
	output: unknown;
	queuePosition: number | null;
	rawStatus: string;
}

export interface ServerlessJobStatus {
	delayTimeMs: number | null;
	error: unknown;
	executionTimeMs: number | null;
	jobId: string | null;
	output: unknown;
	queuePosition: number | null;
	rawStatus: string;
	retries: number | null;
}

export interface ServerlessSubmitInput {
	endpointId: string;
	input: Record<string, unknown>;
	policy?: Record<string, unknown>;
	/** Webhook URL что RunPod дёрнет при завершении job'а. */
	webhook?: string;
}

export interface ServerlessRunSyncInput extends ServerlessSubmitInput {
	/**
	 * Сколько RunPod держит коннект открытым ожидая результата (мс).
	 * RunPod ограничивает 1000–300000ms; по умолчанию 90000 на их стороне.
	 */
	waitMs?: number;
}

export interface ServerlessEndpointHealth {
	jobs: {
		completed: number;
		failed: number;
		inProgress: number;
		inQueue: number;
		retried: number;
	};
	workers: {
		idle: number;
		initializing: number;
		ready: number;
		running: number;
		throttled: number;
		unhealthy: number;
	};
}

export interface ServerlessPurgeResult {
	removed: number;
	status: string;
}

/**
 * Низкоуровневый клиент серверлесс-API RunPod (`/v2/{endpointId}/...`).
 *
 * Возвращает «сырые» статусы — нормализация в `InferenceStatus` живёт в
 * `engine/serverless-engine.ts`, потому что именно engine знает про политику
 * (например, считать ли ошибку терминальной).
 *
 * `runSync` — синхронная разновидность submit'а: ждёт результат до `waitMs`
 * (или пока RunPod сам не сбросит коннект). Возвращает уже терминальный
 * статус если успели; иначе клиент должен дополнительно поллить `/status`.
 *
 * `health` — состояние endpoint'а: сколько worker'ов idle/running/initializing
 * и сколько jobs в очереди. Используется warm-up runner'ом для решения, надо
 * ли пинговать.
 *
 * `purgeQueue` / `retry` — recovery-операции; engine их не дёргает в hot path.
 */
export interface RunpodServerlessApi {
	cancel(input: { endpointId: string; jobId: string }): Promise<void>;
	getHealth(input: { endpointId: string }): Promise<ServerlessEndpointHealth>;
	getStatus(input: {
		endpointId: string;
		jobId: string;
	}): Promise<ServerlessJobStatus>;
	purgeQueue(input: { endpointId: string }): Promise<ServerlessPurgeResult>;
	retry(input: {
		endpointId: string;
		jobId: string;
	}): Promise<ServerlessSubmission>;
	runSync(input: ServerlessRunSyncInput): Promise<ServerlessSubmission>;
	submit(input: ServerlessSubmitInput): Promise<ServerlessSubmission>;
}

export function createServerlessApi(
	http: RunpodHttpClient
): RunpodServerlessApi {
	const buildSubmitBody = (input: ServerlessSubmitInput) => {
		const body: Record<string, unknown> = { input: input.input };
		if (input.policy) {
			body.policy = input.policy;
		}
		if (input.webhook) {
			body.webhook = input.webhook;
		}
		return body;
	};

	return {
		async cancel({ endpointId, jobId }) {
			await http.post(
				`/${endpointId}/cancel/${jobId}`,
				undefined,
				"runpod serverless /cancel"
			);
		},

		async getHealth({ endpointId }) {
			const body = await http.get(
				`/${endpointId}/health`,
				"runpod serverless /health"
			);
			const parsed = healthResponseSchema.parse(body);
			return {
				jobs: {
					completed: parsed.jobs?.completed ?? 0,
					failed: parsed.jobs?.failed ?? 0,
					inProgress: parsed.jobs?.inProgress ?? 0,
					inQueue: parsed.jobs?.inQueue ?? 0,
					retried: parsed.jobs?.retried ?? 0,
				},
				workers: {
					idle: parsed.workers?.idle ?? 0,
					initializing: parsed.workers?.initializing ?? 0,
					ready: parsed.workers?.ready ?? 0,
					running: parsed.workers?.running ?? 0,
					throttled: parsed.workers?.throttled ?? 0,
					unhealthy: parsed.workers?.unhealthy ?? 0,
				},
			};
		},

		async getStatus({ endpointId, jobId }) {
			const body = await http.get(
				`/${endpointId}/status/${jobId}`,
				"runpod serverless /status"
			);
			const parsed = statusResponseSchema.parse(body);
			return {
				delayTimeMs: parsed.delayTime ?? null,
				error: parsed.error ?? null,
				executionTimeMs: parsed.executionTime ?? null,
				jobId: parsed.id ?? null,
				output: parsed.output ?? null,
				queuePosition: parsed.queuePosition ?? parsed.queue_position ?? null,
				rawStatus: parsed.status ?? "IN_QUEUE",
				retries: parsed.retries ?? null,
			};
		},

		async purgeQueue({ endpointId }) {
			const body = await http.post(
				`/${endpointId}/purge-queue`,
				undefined,
				"runpod serverless /purge-queue"
			);
			const parsed = purgeResponseSchema.parse(body);
			return {
				removed: parsed.removed ?? 0,
				status: parsed.status ?? "completed",
			};
		},

		async retry({ endpointId, jobId }) {
			const response = await http.post(
				`/${endpointId}/retry/${jobId}`,
				undefined,
				"runpod serverless /retry"
			);
			return parseSubmission(response);
		},

		async runSync({ endpointId, waitMs, ...rest }) {
			const suffix = waitMs ? `?wait=${waitMs}` : "";
			const response = await http.post(
				`/${endpointId}/runsync${suffix}`,
				buildSubmitBody({ ...rest, endpointId }),
				"runpod serverless /runsync"
			);
			return parseSubmission(response);
		},

		async submit(input) {
			const response = await http.post(
				`/${input.endpointId}/run`,
				buildSubmitBody(input),
				"runpod serverless /run"
			);
			return parseSubmission(response);
		},
	};
}

function parseSubmission(
	response: Record<string, unknown>
): ServerlessSubmission {
	const parsed = submissionResponseSchema.parse(response);
	return {
		delayTimeMs: parsed.delayTime ?? null,
		error: parsed.error ?? null,
		executionTimeMs: parsed.executionTime ?? null,
		jobId: parsed.id,
		output: parsed.output ?? null,
		queuePosition: parsed.queuePosition ?? parsed.queue_position ?? null,
		rawStatus: parsed.status ?? "IN_QUEUE",
	};
}
