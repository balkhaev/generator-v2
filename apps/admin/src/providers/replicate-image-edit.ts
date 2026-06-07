/**
 * Минимальный Replicate-клиент для image-edit в dataset-prep пайплайне.
 *
 * В отличие от инференс-клиента generator-а (`packages/.../replicate.ts`,
 * заточен под версионные community-модели и InferenceClient-интерфейс), здесь
 * нам нужен простой submit → poll → extract-url для official-моделей
 * (`owner/name`), которые умеют редактировать одно фото по промпту. Поэтому
 * бьём в `/v1/models/{owner}/{name}/predictions` (без pinned version) и ждём
 * терминальный статус прямо в этом вызове — задачи короткие (~10-30s).
 */

import { setTimeout as sleep } from "node:timers/promises";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const REQUEST_TIMEOUT_MS = 120_000;

const REPLICATE_TERMINAL_STATUSES = new Set([
	"succeeded",
	"failed",
	"canceled",
]);

interface ReplicatePrediction {
	error?: unknown;
	id?: string;
	output?: unknown;
	status?: string;
	urls?: { get?: string };
}

export interface RunReplicateImageEditInput {
	apiToken: string;
	fetchImpl?: typeof fetch;
	input: Record<string, unknown>;
	/** Official model slug, e.g. `qwen/qwen-image-edit`. */
	model: string;
	pollMs: number;
	timeoutMs: number;
}

function extractErrorMessage(value: unknown, fallback: string): string {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (value && typeof value === "object") {
		const message = (value as { message?: unknown }).message;
		if (typeof message === "string" && message.length > 0) {
			return message;
		}
		const detail = (value as { detail?: unknown }).detail;
		if (typeof detail === "string" && detail.length > 0) {
			return detail;
		}
		try {
			return JSON.stringify(value);
		} catch {
			return fallback;
		}
	}
	return fallback;
}

async function replicateRequest(
	apiToken: string,
	url: string,
	fetchImpl: typeof fetch,
	init?: RequestInit
): Promise<ReplicatePrediction> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchImpl(url, {
			...init,
			signal: controller.signal,
			headers: {
				authorization: `Bearer ${apiToken}`,
				"content-type": "application/json",
				...(init?.headers as Record<string, string> | undefined),
			},
		});
		const body = (await response
			.json()
			.catch(() => null)) as ReplicatePrediction | null;
		if (!response.ok || body === null) {
			const message = extractErrorMessage(
				body ?? {},
				`Replicate request failed with status ${response.status}`
			);
			throw new Error(message);
		}
		return body;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Submits a single image-edit prediction and polls until the prediction
 * reaches a terminal status. Returns the raw `output` field so the caller's
 * adapter can extract the resulting image URL.
 */
export async function runReplicateImageEdit(
	input: RunReplicateImageEditInput
): Promise<unknown> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const submit = await replicateRequest(
		input.apiToken,
		`${REPLICATE_API_BASE}/models/${input.model}/predictions`,
		fetchImpl,
		{
			body: JSON.stringify({ input: input.input }),
			method: "POST",
		}
	);

	if (typeof submit.id !== "string" || submit.id.length === 0) {
		throw new Error("Replicate prediction response did not include id");
	}

	const statusUrl =
		submit.urls?.get ?? `${REPLICATE_API_BASE}/predictions/${submit.id}`;

	if (
		submit.status &&
		REPLICATE_TERMINAL_STATUSES.has(submit.status) &&
		submit.status === "succeeded"
	) {
		return submit.output ?? null;
	}

	const deadline = Date.now() + input.timeoutMs;
	while (Date.now() < deadline) {
		const prediction = await replicateRequest(
			input.apiToken,
			statusUrl,
			fetchImpl
		);
		const status = prediction.status ?? "starting";
		if (status === "succeeded") {
			return prediction.output ?? null;
		}
		if (status === "failed" || status === "canceled") {
			throw new Error(
				`Replicate ${input.model} ${status}: ${extractErrorMessage(prediction.error, status)}`
			);
		}
		await sleep(input.pollMs);
	}

	throw new Error(
		`Replicate ${input.model} timed out after ${input.timeoutMs}ms`
	);
}
