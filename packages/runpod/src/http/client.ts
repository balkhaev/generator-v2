const TRAILING_SLASH = /\/$/u;
const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity/iu;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_LENGTH = 2000;
const ERROR_BODY_TRUNCATE_AT = 1997;

export type RunpodFetch = (
	input: string,
	init?: RequestInit
) => Promise<Response>;

export interface RunpodHttpClientOptions {
	apiKey: string;
	baseUrl: string;
	fetchImpl?: RunpodFetch;
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

/**
 * Низкоуровневый клиент к RunPod API. Не знает про serverless/pod различия —
 * только bearer auth, JSON, timeout, унифицированный error parsing. Никаких
 * retry-петель здесь: ретраи делаются на уровне engine, чтобы не дублировать
 * idempotency-логику.
 */
export function createRunpodHttpClient(
	options: RunpodHttpClientOptions
): RunpodHttpClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = options.baseUrl.replace(TRAILING_SLASH, "");
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const authHeaders: Record<string, string> = {
		authorization: `Bearer ${options.apiKey}`,
		"content-type": "application/json",
	};

	const request = async <T extends Record<string, unknown>>(
		path: string,
		init: RequestInit | undefined,
		label: string,
		expectsJson: boolean
	): Promise<T> => {
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
				const message = await readErrorMessage(response);
				throw new Error(`${label} failed (${response.status}): ${message}`);
			}
			if (!expectsJson || response.status === 204) {
				return {} as T;
			}
			const parsed = (await response.json().catch(() => null)) as T | null;
			if (parsed === null) {
				throw new Error(`${label}: empty or invalid JSON response`);
			}
			return parsed;
		} finally {
			clearTimeout(timer);
		}
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

export function isNoCapacityError(error: unknown): boolean {
	return error instanceof Error && NO_CAPACITY_PATTERN.test(error.message);
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
