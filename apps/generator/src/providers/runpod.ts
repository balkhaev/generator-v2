import type {
	InferenceClient,
	InferenceJob,
	InferenceStatus,
	InferenceSubmission,
} from "./inference";

const RUNPOD_ENDPOINT_ID_PREFIX = "runpod:";
const REQUEST_TIMEOUT_MS = 30_000;
const TRAILING_SLASH = /\/$/;

const runpodStatusMap: Record<string, InferenceStatus> = {
	CANCELLED: "failed",
	COMPLETED: "succeeded",
	ERROR: "failed",
	FAILED: "failed",
	IN_PROGRESS: "running",
	IN_QUEUE: "queued",
	TIMED_OUT: "failed",
};

type RunpodFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function formatRunpodProviderEndpointId(endpointId: string): string {
	return `${RUNPOD_ENDPOINT_ID_PREFIX}${endpointId}`;
}

export function isRunpodProviderEndpointId(
	endpointId: string | undefined
): boolean {
	return endpointId?.startsWith(RUNPOD_ENDPOINT_ID_PREFIX) ?? false;
}

export function parseRunpodProviderEndpointId(endpointId: string): string {
	if (!isRunpodProviderEndpointId(endpointId)) {
		throw new Error("RunPod provider requires a runpod-prefixed endpointId");
	}
	return endpointId.slice(RUNPOD_ENDPOINT_ID_PREFIX.length);
}

export function normalizeRunpodStatus(status: string): InferenceStatus {
	const normalized = runpodStatusMap[status];
	if (!normalized) {
		throw new Error(`Unsupported RunPod status: ${status}`);
	}
	return normalized;
}

function stringifyBodySnippet(body: Record<string, unknown>): string | null {
	const keys = Object.keys(body);
	if (keys.length === 0) {
		return null;
	}
	try {
		const encoded = JSON.stringify(body);
		return encoded.length <= 2000 ? encoded : `${encoded.slice(0, 1997)}...`;
	} catch {
		return null;
	}
}

function extractErrorMessage(
	body: Record<string, unknown>,
	fallbackStatus: number
): string {
	for (const key of ["error", "message", "detail"] as const) {
		const value = body[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
		if (value && typeof value === "object") {
			const nestedMessage = (value as { message?: unknown }).message;
			if (typeof nestedMessage === "string" && nestedMessage.length > 0) {
				return nestedMessage;
			}
			try {
				return JSON.stringify(value);
			} catch {
				// fall through to the generic snippet.
			}
		}
	}

	const snippet = stringifyBodySnippet(body);
	if (snippet) {
		return snippet;
	}

	return `RunPod request failed with status ${fallbackStatus}`;
}

function readStringField(
	body: Record<string, unknown>,
	key: string
): string | null {
	const value = body[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function extractQueuePosition(body: Record<string, unknown>): number | null {
	for (const key of ["queuePosition", "queue_position"] as const) {
		const value = body[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return null;
}

function buildRunpodRequestBody(payload: Record<string, unknown>): {
	input: Record<string, unknown>;
	policy?: Record<string, unknown>;
} {
	const { __runpodEndpoint, __runpodPolicy, ...input } = payload;
	if (
		__runpodPolicy &&
		typeof __runpodPolicy === "object" &&
		!Array.isArray(__runpodPolicy)
	) {
		return {
			input,
			policy: __runpodPolicy as Record<string, unknown>,
		};
	}
	return { input };
}

function normalizeRunpodOutput(output: unknown): unknown {
	if (Array.isArray(output)) {
		return output.map(normalizeRunpodOutput);
	}
	if (!output || typeof output !== "object") {
		return output;
	}
	const record = output as Record<string, unknown>;
	const normalized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		normalized[key] = normalizeRunpodOutput(value);
	}
	const base64 = record.base64;
	if (
		typeof base64 === "string" &&
		base64.length > 0 &&
		!base64.startsWith("data:")
	) {
		normalized.dataUrl = `data:image/png;base64,${base64}`;
	}
	return normalized;
}

export type RunpodClient = InferenceClient;

export function createRunpodClient(options: {
	apiBaseUrl?: string;
	apiKey: string;
	endpoints: Record<string, string | undefined>;
	fetchImpl?: RunpodFetch;
}): InferenceClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const apiBaseUrl = (options.apiBaseUrl ?? "https://api.runpod.ai/v2").replace(
		TRAILING_SLASH,
		""
	);

	const authHeaders = () => ({
		authorization: `Bearer ${options.apiKey}`,
		"content-type": "application/json",
	});

	const request = async <T>(
		url: string,
		init: RequestInit | undefined,
		label: string
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
				const message = extractErrorMessage(body ?? {}, response.status);
				throw new Error(`${label}: ${message}`);
			}
			return body as T & Record<string, unknown>;
		} finally {
			clearTimeout(timeout);
		}
	};

	const resolveEndpointId = (endpointKey: unknown): string => {
		if (typeof endpointKey !== "string" || endpointKey.length === 0) {
			throw new Error("RunPod provider requires __runpodEndpoint in payload");
		}
		const endpointId = options.endpoints[endpointKey]?.trim();
		if (!endpointId) {
			throw new Error(`RunPod endpoint is not configured: ${endpointKey}`);
		}
		return endpointId;
	};

	return {
		async submit(payload): Promise<InferenceSubmission> {
			const endpointId = resolveEndpointId(payload.__runpodEndpoint);
			const body = await request<{
				id: string;
				status?: string;
			}>(
				`${apiBaseUrl}/${endpointId}/run`,
				{
					body: JSON.stringify(buildRunpodRequestBody(payload)),
					method: "POST",
				},
				"RunPod /run"
			);
			const jobId = readStringField(body, "id");
			if (!jobId) {
				throw new Error("RunPod /run response did not include job id");
			}
			const rawStatus = readStringField(body, "status") ?? "IN_QUEUE";
			return {
				endpointId: formatRunpodProviderEndpointId(endpointId),
				jobId,
				queuePosition: extractQueuePosition(body),
				status: normalizeRunpodStatus(rawStatus),
			};
		},

		async getStatus(jobId, endpointId): Promise<InferenceJob> {
			if (!endpointId) {
				throw new Error("RunPod provider requires endpointId for status check");
			}
			const rawEndpointId = parseRunpodProviderEndpointId(endpointId);
			const body = await request<{
				error?: unknown;
				output?: unknown;
				status?: string;
			}>(
				`${apiBaseUrl}/${rawEndpointId}/status/${jobId}`,
				undefined,
				"RunPod /status"
			);
			const rawStatus = readStringField(body, "status") ?? "IN_QUEUE";
			const status = body.error ? "failed" : normalizeRunpodStatus(rawStatus);
			const errorSummary =
				status === "failed" ? extractErrorMessage(body, 500) : null;
			return {
				endpointId,
				errorSummary,
				jobId,
				output:
					status === "succeeded"
						? normalizeRunpodOutput(body.output ?? null)
						: null,
				progressPct: status === "succeeded" ? 100 : null,
				queuePosition: extractQueuePosition(body),
				status,
			};
		},

		async cancel(jobId, endpointId): Promise<void> {
			if (!endpointId) {
				throw new Error("RunPod provider requires endpointId for cancellation");
			}
			const rawEndpointId = parseRunpodProviderEndpointId(endpointId);
			await request<Record<string, unknown>>(
				`${apiBaseUrl}/${rawEndpointId}/cancel/${jobId}`,
				{ method: "POST" },
				"RunPod /cancel"
			);
		},
	};
}
