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

type FalFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function normalizeFalStatus(status: string): InferenceStatus {
	const normalized = falStatusMap[status];
	if (!normalized) {
		throw new Error(`Unsupported fal.ai status: ${status}`);
	}
	return normalized;
}

function extractErrorMessage(
	body: Record<string, unknown>,
	fallbackStatus: number
): string {
	for (const key of ["detail", "error", "message"]) {
		const value = body[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
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
				status: body.status ? normalizeFalStatus(body.status) : "queued",
			};
		},

		async getStatus(jobId, endpointId): Promise<InferenceJob> {
			if (!endpointId) {
				throw new Error("fal.ai provider requires endpointId for status check");
			}

			const statusBody = await request<{
				status: string;
				request_id: string;
				error?: string;
			}>(`${apiBaseUrl}/${endpointId}/requests/${jobId}/status`);

			const statusError =
				typeof statusBody.error === "string" ? statusBody.error : null;

			if (statusError) {
				return {
					endpointId,
					jobId,
					status: "failed",
					output: null,
					errorSummary: statusError,
				};
			}

			const status = normalizeFalStatus(statusBody.status);

			if (status !== "succeeded") {
				return {
					endpointId,
					jobId,
					status,
					output: null,
					errorSummary: null,
				};
			}

			const resultBody = await request<Record<string, unknown>>(
				`${apiBaseUrl}/${endpointId}/requests/${jobId}`
			);

			return {
				endpointId,
				jobId,
				status: "succeeded",
				output: resultBody,
				errorSummary: null,
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
