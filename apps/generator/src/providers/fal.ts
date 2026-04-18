import type {
	InferenceClient,
	InferenceJob,
	InferenceStatus,
	InferenceSubmission,
} from "./inference";

const falStatusMap: Record<string, InferenceStatus> = {
	IN_QUEUE: "queued",
	IN_PROGRESS: "running",
	COMPLETED: "succeeded",
};

const REQUEST_TIMEOUT_MS = 30_000;
const TRAILING_SLASH = /\/$/;
const CANONICAL_ENDPOINT_PATTERN = /\/requests\/[^/]+/;

/**
 * Reasonable patterns we see in fal.ai logs across diffusion-style workflows.
 * Examples actually observed:
 *   - "Sampling step 12/40"
 *   - "step 8 / 50"
 *   - "Progress: 25%"
 *   - "12.5%"
 *   - "[10/40]"
 */
const STEP_PATTERN_SLASH = /(?:^|\D)(\d{1,4})\s*\/\s*(\d{1,4})(?:\D|$)/;
const PERCENT_PATTERN = /(\d{1,3}(?:\.\d{1,2})?)\s*%/;

interface FalLogEntry {
	level?: string;
	message?: string;
	timestamp?: string;
}

function parseProgressFromLogLine(line: string): number | null {
	const stepMatch = line.match(STEP_PATTERN_SLASH);
	if (stepMatch?.[1] && stepMatch[2]) {
		const current = Number.parseInt(stepMatch[1], 10);
		const total = Number.parseInt(stepMatch[2], 10);
		if (total > 0 && current >= 0 && current <= total) {
			return Math.round((current / total) * 100);
		}
	}

	const percentMatch = line.match(PERCENT_PATTERN);
	if (percentMatch?.[1]) {
		const value = Number.parseFloat(percentMatch[1]);
		if (Number.isFinite(value) && value >= 0 && value <= 100) {
			return Math.round(value);
		}
	}

	return null;
}

interface FalProgressSnapshot {
	lastLogLine: string | null;
	progressPct: number | null;
}

export function extractFalProgressSnapshot(
	logs: FalLogEntry[] | undefined
): FalProgressSnapshot {
	if (!Array.isArray(logs) || logs.length === 0) {
		return { lastLogLine: null, progressPct: null };
	}

	let lastLogLine: string | null = null;
	let progressPct: number | null = null;

	for (let i = logs.length - 1; i >= 0; i -= 1) {
		const entry = logs[i];
		const message =
			typeof entry?.message === "string" ? entry.message.trim() : "";
		if (message.length === 0) {
			continue;
		}
		if (lastLogLine === null) {
			lastLogLine =
				message.length > 240 ? `${message.slice(0, 237)}…` : message;
		}
		if (progressPct === null) {
			const parsed = parseProgressFromLogLine(message);
			if (parsed !== null) {
				progressPct = parsed;
			}
		}
		if (lastLogLine !== null && progressPct !== null) {
			break;
		}
	}

	return { lastLogLine, progressPct };
}

type FalFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function normalizeFalStatus(status: string): InferenceStatus {
	const normalized = falStatusMap[status];
	if (!normalized) {
		throw new Error(`Unsupported fal.ai status: ${status}`);
	}
	return normalized;
}

function pickValidationMessage(record: Record<string, unknown>): string | null {
	if (typeof record.msg === "string" && record.msg.length > 0) {
		return record.msg;
	}
	if (typeof record.message === "string" && record.message.length > 0) {
		return record.message;
	}
	return null;
}

function formatDetailEntry(entry: unknown): string | null {
	if (typeof entry === "string" && entry.length > 0) {
		return entry;
	}
	if (!entry || typeof entry !== "object") {
		return null;
	}
	const record = entry as Record<string, unknown>;
	const msg = pickValidationMessage(record);
	if (!msg) {
		return null;
	}
	const rawLoc = record.loc;
	let location = "";
	if (Array.isArray(rawLoc)) {
		const parts = rawLoc.filter(
			(item): item is string | number =>
				typeof item === "string" || typeof item === "number"
		);
		if (parts.length > 0) {
			location = parts.join(".");
		}
	}
	return location ? `${location}: ${msg}` : msg;
}

function joinDetailEntries(entries: unknown[]): string | null {
	const parts = entries
		.map(formatDetailEntry)
		.filter((item): item is string => item !== null);
	return parts.length > 0 ? parts.join("; ") : null;
}

function stringifyBodySnippet(body: Record<string, unknown>): string | null {
	const keys = Object.keys(body);
	if (keys.length === 0) {
		return null;
	}
	try {
		const encoded = JSON.stringify(body);
		if (encoded.length <= 2000) {
			return encoded;
		}
		return `${encoded.slice(0, 1997)}…`;
	} catch {
		return null;
	}
}

function messageFromDetailField(detail: unknown): string | null {
	if (typeof detail === "string" && detail.length > 0) {
		return detail;
	}
	if (Array.isArray(detail)) {
		return joinDetailEntries(detail);
	}
	if (detail && typeof detail === "object") {
		try {
			return JSON.stringify(detail);
		} catch {
			return null;
		}
	}
	return null;
}

function messageFromNestedError(body: Record<string, unknown>): string | null {
	const nestedError = body.error;
	if (!nestedError || typeof nestedError !== "object") {
		return null;
	}
	const message = (nestedError as { message?: unknown }).message;
	if (typeof message === "string" && message.length > 0) {
		return message;
	}
	return null;
}

function messageFromTopLevelStrings(
	body: Record<string, unknown>
): string | null {
	for (const key of ["error", "message"] as const) {
		const value = body[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return null;
}

function extractErrorMessage(
	body: Record<string, unknown>,
	fallbackStatus: number
): string {
	const fromDetail = messageFromDetailField(body.detail);
	if (fromDetail) {
		return fromDetail;
	}

	const fromNested = messageFromNestedError(body);
	if (fromNested) {
		return fromNested;
	}

	const fromTop = messageFromTopLevelStrings(body);
	if (fromTop) {
		return fromTop;
	}

	if (Array.isArray(body.errors)) {
		const joined = joinDetailEntries(body.errors);
		if (joined) {
			return joined;
		}
	}

	const snippet = stringifyBodySnippet(body);
	if (snippet) {
		return snippet;
	}

	return `fal.ai request failed with status ${fallbackStatus}`;
}

/**
 * fal.ai normalizes model paths in status/response URLs.
 * E.g. submitting to `fal-ai/flux/dev` returns status_url with `fal-ai/flux/requests/...`.
 * We extract the canonical model path from `status_url` to use for subsequent requests.
 */
function extractCanonicalEndpoint(
	statusUrl: string | undefined,
	fallback: string
): string {
	if (!statusUrl) {
		return fallback;
	}
	try {
		const url = new URL(statusUrl);
		const match = url.pathname.match(CANONICAL_ENDPOINT_PATTERN);
		if (match) {
			return url.pathname.slice(1, match.index).replace(TRAILING_SLASH, "");
		}
	} catch {
		// Fall back to original model path
	}
	return fallback;
}

export type FalClient = InferenceClient;

export function createFalClient(options: {
	apiKey: string;
	apiBaseUrl?: string;
	fetchImpl?: FalFetch;
}): InferenceClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const apiBaseUrl = (options.apiBaseUrl ?? "https://queue.fal.run").replace(
		TRAILING_SLASH,
		""
	);

	const authHeaders = () => ({
		authorization: `Key ${options.apiKey}`,
		"content-type": "application/json",
	});

	const request = async <T>(
		url: string,
		init?: RequestInit
	): Promise<T & Record<string, unknown>> => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetchImpl(url, {
				...init,
				signal: controller.signal,
				headers: {
					...authHeaders(),
					...(init?.headers as Record<string, string> | undefined),
				},
			});
			const body = (await response.json().catch(() => null)) as Record<
				string,
				unknown
			> | null;
			if (!response.ok || body === null) {
				throw new Error(extractErrorMessage(body ?? {}, response.status));
			}
			return body as T & Record<string, unknown>;
		} finally {
			clearTimeout(timeout);
		}
	};

	return {
		async submit(payload): Promise<InferenceSubmission> {
			const { __falModel, ...input } = payload as Record<string, unknown>;
			if (typeof __falModel !== "string" || __falModel.length === 0) {
				throw new Error("fal.ai provider requires __falModel in payload");
			}

			const body = await request<{
				request_id: string;
				status?: string;
				status_url?: string;
				queue_position?: number;
			}>(`${apiBaseUrl}/${__falModel}`, {
				method: "POST",
				body: JSON.stringify(input),
			});

			const canonicalEndpoint = extractCanonicalEndpoint(
				body.status_url,
				__falModel
			);

			return {
				endpointId: canonicalEndpoint,
				jobId: body.request_id,
				queuePosition:
					typeof body.queue_position === "number" ? body.queue_position : null,
				status: body.status ? normalizeFalStatus(body.status) : "queued",
			};
		},

		async getStatus(jobId, endpointId): Promise<InferenceJob> {
			if (!endpointId) {
				throw new Error("fal.ai provider requires endpointId for status check");
			}

			// `?logs=1` заставляет fal вернуть массив `logs[]` со step-сообщениями
			// и `queue_position` пока заявка ждёт слот. Без этого флага мы видим
			// только дискретный статус — undestroyable mёртвый прогресс.
			const statusBody = await request<{
				status: string;
				request_id: string;
				error?: string;
				logs?: FalLogEntry[];
				queue_position?: number;
			}>(`${apiBaseUrl}/${endpointId}/requests/${jobId}/status?logs=1`);

			const statusError =
				typeof statusBody.error === "string" ? statusBody.error : null;

			if (statusError) {
				return {
					endpointId,
					errorSummary: statusError,
					jobId,
					output: null,
					status: "failed",
				};
			}

			const status = normalizeFalStatus(statusBody.status);
			const { lastLogLine, progressPct } = extractFalProgressSnapshot(
				statusBody.logs
			);
			const queuePosition =
				typeof statusBody.queue_position === "number"
					? statusBody.queue_position
					: null;

			if (status !== "succeeded") {
				return {
					endpointId,
					errorSummary: null,
					jobId,
					lastLogLine,
					output: null,
					progressPct,
					queuePosition,
					status,
				};
			}

			const resultBody = await request<Record<string, unknown>>(
				`${apiBaseUrl}/${endpointId}/requests/${jobId}`
			);

			return {
				endpointId,
				errorSummary: null,
				jobId,
				lastLogLine,
				output: resultBody,
				progressPct: 100,
				queuePosition: null,
				status: "succeeded",
			};
		},

		async cancel(jobId, endpointId): Promise<void> {
			if (!endpointId) {
				return;
			}
			try {
				await fetchImpl(
					`${apiBaseUrl}/${endpointId}/requests/${jobId}/cancel`,
					{
						method: "PUT",
						headers: authHeaders(),
					}
				);
			} catch {
				// Best-effort: cancellation failures are non-critical
			}
		},
	};
}
