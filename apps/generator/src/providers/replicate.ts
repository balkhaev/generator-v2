import type {
	InferenceClient,
	InferenceJob,
	InferenceStatus,
	InferenceSubmission,
} from "./inference";

const REPLICATE_ENDPOINT_ID_PREFIX = "replicate:";
const REQUEST_TIMEOUT_MS = 30_000;
const TRAILING_SLASH = /\/$/;

const replicateStatusMap: Record<string, InferenceStatus> = {
	canceled: "failed",
	failed: "failed",
	processing: "running",
	starting: "queued",
	succeeded: "succeeded",
	successful: "succeeded",
};

type ReplicateFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface ReplicatePrediction {
	error?: unknown;
	id?: string;
	logs?: string | null;
	output?: unknown;
	status?: string;
}

export function formatReplicateProviderEndpointId(version: string): string {
	return `${REPLICATE_ENDPOINT_ID_PREFIX}${version}`;
}

export function isReplicateProviderEndpointId(
	endpointId: string | undefined
): boolean {
	return endpointId?.startsWith(REPLICATE_ENDPOINT_ID_PREFIX) ?? false;
}

export function parseReplicateProviderEndpointId(endpointId: string): string {
	if (!isReplicateProviderEndpointId(endpointId)) {
		throw new Error(
			"Replicate provider requires a replicate-prefixed endpointId"
		);
	}
	return endpointId.slice(REPLICATE_ENDPOINT_ID_PREFIX.length);
}

export function normalizeReplicateStatus(status: string): InferenceStatus {
	const normalized = replicateStatusMap[status];
	if (!normalized) {
		throw new Error(`Unsupported Replicate status: ${status}`);
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

function messageFromValue(value: unknown): string | null {
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
			return null;
		}
	}
	return null;
}

function extractErrorMessage(
	body: Record<string, unknown>,
	fallbackStatus: number
): string {
	for (const key of ["detail", "error", "message"] as const) {
		const message = messageFromValue(body[key]);
		if (message) {
			return message;
		}
	}

	const snippet = stringifyBodySnippet(body);
	if (snippet) {
		return snippet;
	}

	return `Replicate request failed with status ${fallbackStatus}`;
}

function extractLastLogLine(logs: string | null | undefined): string | null {
	if (!logs) {
		return null;
	}
	const lines = logs
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const lastLine = lines.at(-1);
	if (!lastLine) {
		return null;
	}
	return lastLine.length > 240 ? `${lastLine.slice(0, 237)}...` : lastLine;
}

function buildReplicateRequestBody(payload: Record<string, unknown>): {
	input: Record<string, unknown>;
	version: string;
} {
	const { __replicateVersion, ...input } = payload;
	if (
		typeof __replicateVersion !== "string" ||
		__replicateVersion.length === 0
	) {
		throw new Error(
			"Replicate provider requires __replicateVersion in payload"
		);
	}
	return {
		input,
		version: __replicateVersion,
	};
}

export type ReplicateClient = InferenceClient;

export function createReplicateClient(options: {
	apiBaseUrl?: string;
	apiToken: string;
	fetchImpl?: ReplicateFetch;
}): InferenceClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const apiBaseUrl = (
		options.apiBaseUrl ?? "https://api.replicate.com/v1"
	).replace(TRAILING_SLASH, "");

	const authHeaders = () => ({
		authorization: `Bearer ${options.apiToken}`,
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

	const normalizePrediction = (
		body: ReplicatePrediction & Record<string, unknown>,
		endpointId: string,
		fallbackJobId: string
	): InferenceJob => {
		const rawStatus =
			typeof body.status === "string" ? body.status : "starting";
		const status = body.error ? "failed" : normalizeReplicateStatus(rawStatus);
		const errorSummary =
			status === "failed" ? (messageFromValue(body.error) ?? rawStatus) : null;
		return {
			endpointId,
			errorSummary,
			jobId: typeof body.id === "string" ? body.id : fallbackJobId,
			lastLogLine: extractLastLogLine(body.logs),
			output: status === "succeeded" ? (body.output ?? null) : null,
			progressPct: status === "succeeded" ? 100 : null,
			queuePosition: null,
			status,
		};
	};

	return {
		async submit(payload): Promise<InferenceSubmission> {
			const requestBody = buildReplicateRequestBody(payload);
			const body = await request<ReplicatePrediction>(
				`${apiBaseUrl}/predictions`,
				{
					body: JSON.stringify(requestBody),
					method: "POST",
				},
				"Replicate predictions.create"
			);
			if (typeof body.id !== "string" || body.id.length === 0) {
				throw new Error("Replicate prediction response did not include id");
			}
			const rawStatus =
				typeof body.status === "string" ? body.status : "starting";
			return {
				endpointId: formatReplicateProviderEndpointId(requestBody.version),
				jobId: body.id,
				lastLogLine: extractLastLogLine(body.logs),
				progressPct: null,
				queuePosition: null,
				status: body.error ? "failed" : normalizeReplicateStatus(rawStatus),
			};
		},

		async getStatus(jobId, endpointId): Promise<InferenceJob> {
			if (!endpointId) {
				throw new Error(
					"Replicate provider requires endpointId for status check"
				);
			}
			parseReplicateProviderEndpointId(endpointId);
			const body = await request<ReplicatePrediction>(
				`${apiBaseUrl}/predictions/${jobId}`,
				undefined,
				"Replicate predictions.get"
			);
			return normalizePrediction(body, endpointId, jobId);
		},

		async cancel(jobId, endpointId): Promise<void> {
			if (!endpointId) {
				throw new Error(
					"Replicate provider requires endpointId for cancellation"
				);
			}
			parseReplicateProviderEndpointId(endpointId);
			await request<Record<string, unknown>>(
				`${apiBaseUrl}/predictions/${jobId}/cancel`,
				{ method: "POST" },
				"Replicate predictions.cancel"
			);
		},
	};
}
