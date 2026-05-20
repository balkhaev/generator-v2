const TRAILING_SLASH = /\/$/u;
const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity/iu;
const TRANSIENT_NETWORK_PATTERN =
	/fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|UND_ERR|network|EAI_AGAIN/iu;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_LENGTH = 2000;
const ERROR_BODY_TRUNCATE_AT = 1997;
const DEFAULT_RETRY_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_INITIAL_BACKOFF_MS = 250;
const DEFAULT_RETRY_MAX_BACKOFF_MS = 8000;
const DEFAULT_RETRY_BACKOFF_FACTOR = 2;
const DEFAULT_RETRY_JITTER_RATIO = 0.25;
const RATE_LIMIT_STATUS = 429;
const SERVER_ERROR_THRESHOLD = 500;
const RETRY_STATUSES: ReadonlySet<number> = new Set([
	RATE_LIMIT_STATUS,
	500,
	502,
	503,
	504,
	520,
	521,
	522,
	523,
	524,
]);

export type RunpodFetch = (
	input: string,
	init?: RequestInit
) => Promise<Response>;

/**
 * Politика retry'я для transient HTTP/network ошибок RunPod API:
 *
 * - 429 (rate limit) с уважением Retry-After header'а;
 * - 5xx / Cloudflare 52x (RunPod proxy);
 * - network errors (ECONNRESET, fetch failed, abort на тайм-аут).
 *
 * Для POST на `/v2/{id}/run` и `/v1/pods` ретрай безопасен пока сам RunPod
 * не успел зачислить запрос — а 5xx/network как раз и означают, что не
 * успел. POST `/runsync` тоже идемпотентен на уровне submit, только может
 * вернуть `IN_QUEUE` повторно — это лучше, чем потеря job'а.
 */
export interface RunpodRetryPolicy {
	backoffFactor?: number;
	initialBackoffMs?: number;
	jitterRatio?: number;
	maxAttempts?: number;
	maxBackoffMs?: number;
	/** Hook для тестов / observability — вызывается перед каждым sleep'ом. */
	onRetry?(event: RunpodRetryEvent): void;
}

export interface RunpodRetryEvent {
	attempt: number;
	delayMs: number;
	label: string;
	reason: string;
	status: number | null;
}

export interface RunpodHttpClientOptions {
	apiKey: string;
	baseUrl: string;
	fetchImpl?: RunpodFetch;
	retry?: RunpodRetryPolicy;
	sleep?: (ms: number) => Promise<void>;
	timeoutMs?: number;
}

export interface RunpodHttpClient {
	delete(path: string, label: string): Promise<void>;
	get<T extends Record<string, unknown>>(
		path: string,
		label: string
	): Promise<T>;
	post<T extends Record<string, unknown>>(
		path: string,
		body: Record<string, unknown> | undefined,
		label: string
	): Promise<T>;
}

interface ResolvedRetryPolicy {
	backoffFactor: number;
	initialBackoffMs: number;
	jitterRatio: number;
	maxAttempts: number;
	maxBackoffMs: number;
	onRetry?: RunpodRetryPolicy["onRetry"];
}

type PerformResult<T> =
	| { kind: "ok"; value: T }
	| { kind: "retryable"; error: Error; status: number | null };

/**
 * Низкоуровневый клиент к RunPod API. Не знает про serverless/pod различия —
 * только bearer auth, JSON, timeout, унифицированный error parsing и retry
 * политика для transient'ов. Идемпотентность ретраев — на совести вызывающего
 * слоя (для submit мы тоже ретраим: RunPod возвращает один и тот же job id
 * только при успешном ack'е, а 5xx/network = до ack'а).
 */
export function createRunpodHttpClient(
	options: RunpodHttpClientOptions
): RunpodHttpClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = options.baseUrl.replace(TRAILING_SLASH, "");
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const retryPolicy = resolveRetryPolicy(options.retry);
	const sleep = options.sleep ?? defaultSleep;
	const authHeaders: Record<string, string> = {
		authorization: `Bearer ${options.apiKey}`,
		"content-type": "application/json",
	};

	const performOnce = async <T extends Record<string, unknown>>(
		path: string,
		init: RequestInit | undefined,
		label: string,
		expectsJson: boolean
	): Promise<PerformResult<T>> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(`${baseUrl}${path}`, {
				...init,
				headers: {
					...authHeaders,
					...(init?.headers as Record<string, string> | undefined),
				},
				signal: controller.signal,
			});
			if (!response.ok) {
				return await classifyErrorResponse<T>(response, label);
			}
			return await parseOkResponse<T>(response, expectsJson, label);
		} catch (error) {
			if (isRetryableNetworkError(error)) {
				return {
					error: error instanceof Error ? error : new Error(String(error)),
					kind: "retryable",
					status: null,
				};
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	};

	const request = async <T extends Record<string, unknown>>(
		path: string,
		init: RequestInit | undefined,
		label: string,
		expectsJson: boolean
	): Promise<T> => {
		let lastError: Error | null = null;
		for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
			const result = await performOnce<T>(path, init, label, expectsJson);
			if (result.kind === "ok") {
				return result.value;
			}
			lastError = result.error;
			if (attempt === retryPolicy.maxAttempts) {
				break;
			}
			const retryAfterMs =
				(result.error as Error & { retryAfterMs?: number | null })
					.retryAfterMs ?? null;
			const delayMs = computeBackoffMs({
				attempt,
				policy: retryPolicy,
				retryAfterMs,
			});
			retryPolicy.onRetry?.({
				attempt,
				delayMs,
				label,
				reason: result.error.message,
				status: result.status,
			});
			await sleep(delayMs);
		}
		throw lastError ?? new Error(`${label} failed without producing an error`);
	};

	return {
		delete(path, label) {
			return request<Record<string, unknown>>(
				path,
				{ method: "DELETE" },
				label,
				false
			).then(() => undefined);
		},
		get(path, label) {
			return request(path, undefined, label, true);
		},
		post(path, body, label) {
			const init: RequestInit = { method: "POST" };
			if (body !== undefined) {
				init.body = JSON.stringify(body);
			}
			return request(path, init, label, true);
		},
	};
}

async function classifyErrorResponse<T extends Record<string, unknown>>(
	response: Response,
	label: string
): Promise<PerformResult<T>> {
	const message = await readErrorMessage(response);
	const error = new Error(`${label} failed (${response.status}): ${message}`);
	// Capacity-ошибки от RunPod (503 "no instances", "out of stock") retry
	// бесполезен — нужно либо подождать минутами, либо переехать на другой
	// GPU type. Этим занимается caller (api/pods.ts перебирает volume/gpu),
	// а HTTP-слой должен сразу отдать ошибку.
	if (
		isRetryableStatus(response.status) &&
		!NO_CAPACITY_PATTERN.test(message)
	) {
		const retryAfterMs = readRetryAfterMs(response);
		return {
			error: Object.assign(error, { retryAfterMs }),
			kind: "retryable",
			status: response.status,
		};
	}
	throw error;
}

async function parseOkResponse<T extends Record<string, unknown>>(
	response: Response,
	expectsJson: boolean,
	label: string
): Promise<PerformResult<T>> {
	if (!expectsJson || response.status === 204) {
		return { kind: "ok", value: {} as T };
	}
	const parsed = (await response.json().catch(() => null)) as T | null;
	if (parsed === null) {
		throw new Error(`${label}: empty or invalid JSON response`);
	}
	return { kind: "ok", value: parsed };
}

export function isNoCapacityError(error: unknown): boolean {
	return error instanceof Error && NO_CAPACITY_PATTERN.test(error.message);
}

export function isRetryableNetworkError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	if (error.name === "AbortError") {
		return true;
	}
	return TRANSIENT_NETWORK_PATTERN.test(error.message);
}

export function isRetryableStatus(status: number): boolean {
	return RETRY_STATUSES.has(status) || status >= SERVER_ERROR_THRESHOLD;
}

function resolveRetryPolicy(
	policy: RunpodRetryPolicy | undefined
): ResolvedRetryPolicy {
	return {
		backoffFactor: policy?.backoffFactor ?? DEFAULT_RETRY_BACKOFF_FACTOR,
		initialBackoffMs:
			policy?.initialBackoffMs ?? DEFAULT_RETRY_INITIAL_BACKOFF_MS,
		jitterRatio: policy?.jitterRatio ?? DEFAULT_RETRY_JITTER_RATIO,
		maxAttempts: Math.max(1, policy?.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS),
		maxBackoffMs: policy?.maxBackoffMs ?? DEFAULT_RETRY_MAX_BACKOFF_MS,
		onRetry: policy?.onRetry,
	};
}

function computeBackoffMs(args: {
	attempt: number;
	policy: ResolvedRetryPolicy;
	retryAfterMs: number | null;
}): number {
	const { attempt, policy, retryAfterMs } = args;
	if (retryAfterMs !== null && retryAfterMs > 0) {
		return Math.min(retryAfterMs, policy.maxBackoffMs);
	}
	const exponential = Math.min(
		policy.maxBackoffMs,
		policy.initialBackoffMs * policy.backoffFactor ** (attempt - 1)
	);
	const jitter = exponential * policy.jitterRatio * (Math.random() * 2 - 1);
	return Math.max(0, Math.round(exponential + jitter));
}

function readRetryAfterMs(response: Response): number | null {
	const header = response.headers.get("retry-after");
	if (!header) {
		return null;
	}
	const trimmed = header.trim();
	const asSeconds = Number(trimmed);
	if (Number.isFinite(asSeconds) && asSeconds >= 0) {
		return Math.round(asSeconds * 1000);
	}
	const asDate = Date.parse(trimmed);
	if (!Number.isNaN(asDate)) {
		return Math.max(0, asDate - Date.now());
	}
	return null;
}

async function readErrorMessage(response: Response): Promise<string> {
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = (await response.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (body) {
			return extractErrorFromJson(body) ?? truncate(JSON.stringify(body));
		}
	}
	const text = (await response.text().catch(() => "")).trim();
	if (text) {
		return truncate(text);
	}
	return response.statusText || `status ${response.status}`;
}

function extractErrorFromJson(body: Record<string, unknown>): string | null {
	for (const key of ["error", "message", "detail"] as const) {
		const value = body[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
		if (value && typeof value === "object") {
			const nested = (value as { message?: unknown }).message;
			if (typeof nested === "string" && nested.length > 0) {
				return nested;
			}
		}
	}
	return null;
}

function truncate(text: string): string {
	return text.length <= MAX_ERROR_BODY_LENGTH
		? text
		: `${text.slice(0, ERROR_BODY_TRUNCATE_AT)}...`;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
