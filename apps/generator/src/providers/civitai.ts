import type {
	InferenceClient,
	InferenceJob,
	InferenceStatus,
	InferenceSubmission,
} from "./inference";

const CIVITAI_ENDPOINT_ID_PREFIX = "civitai:";
const DEFAULT_CIVITAI_API_BASE_URL = "https://orchestration.civitai.com";
const REQUEST_TIMEOUT_MS = 30_000;
const TRAILING_SLASH = /\/$/;

const failedEventTypes = new Set([
	"ClaimExpired",
	"Deleted",
	"Expired",
	"Failed",
	"LateRejected",
	"Rejected",
]);
const runningEventTypes = new Set(["Claimed", "Updated"]);

type CivitaiFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface CivitaiJobEvent {
	context?: Record<string, unknown> | null;
	type?: string;
}

interface CivitaiQueuePosition {
	precedingJobs?: number;
}

interface CivitaiProviderJobStatus {
	queuePosition?: CivitaiQueuePosition;
}

interface CivitaiJobStatus {
	jobId?: string | null;
	lastEvent?: CivitaiJobEvent;
	result?: unknown;
	scheduled?: boolean;
	serviceProviders?: Record<string, CivitaiProviderJobStatus> | null;
}

interface CivitaiJobStatusCollection {
	jobs?: CivitaiJobStatus[];
	token?: string | null;
}

export function formatCivitaiProviderEndpointId(model: string): string {
	return `${CIVITAI_ENDPOINT_ID_PREFIX}${model}`;
}

export function isCivitaiProviderEndpointId(
	endpointId: string | undefined
): boolean {
	return endpointId?.startsWith(CIVITAI_ENDPOINT_ID_PREFIX) ?? false;
}

export function parseCivitaiProviderEndpointId(endpointId: string): string {
	if (!isCivitaiProviderEndpointId(endpointId)) {
		throw new Error("Civitai provider requires a civitai-prefixed endpointId");
	}
	return endpointId.slice(CIVITAI_ENDPOINT_ID_PREFIX.length);
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
	for (const key of ["detail", "error", "message", "title"] as const) {
		const message = messageFromValue(body[key]);
		if (message) {
			return message;
		}
	}

	const snippet = stringifyBodySnippet(body);
	if (snippet) {
		return snippet;
	}

	return `Civitai request failed with status ${fallbackStatus}`;
}

function buildUrl(
	apiBaseUrl: string,
	pathname: string,
	query: Record<string, string>
): string {
	const url = new URL(pathname, `${apiBaseUrl}/`);
	for (const [key, value] of Object.entries(query)) {
		url.searchParams.set(key, value);
	}
	return url.href;
}

function readStringField(
	body: Record<string, unknown>,
	key: string
): string | null {
	const value = body[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function buildCivitaiRequestBody(payload: Record<string, unknown>): {
	model: string;
	requestBody: Record<string, unknown>;
} {
	const { __civitaiModel, ...requestBody } = payload;
	if (typeof __civitaiModel !== "string" || __civitaiModel.length === 0) {
		throw new Error("Civitai provider requires __civitaiModel in payload");
	}
	return {
		model: __civitaiModel,
		requestBody: {
			model: __civitaiModel,
			...requestBody,
		},
	};
}

function getEventType(job: CivitaiJobStatus): string | null {
	const type = job.lastEvent?.type;
	return typeof type === "string" && type.length > 0 ? type : null;
}

function extractBlobUrl(result: unknown): string | null {
	if (!result || typeof result !== "object") {
		return null;
	}
	const blobUrl = (result as { blobUrl?: unknown }).blobUrl;
	return typeof blobUrl === "string" && blobUrl.length > 0 ? blobUrl : null;
}

function extractQueuePosition(job: CivitaiJobStatus): number | null {
	const providers = job.serviceProviders;
	if (!providers) {
		return null;
	}
	for (const status of Object.values(providers)) {
		const precedingJobs = status.queuePosition?.precedingJobs;
		if (typeof precedingJobs === "number" && Number.isFinite(precedingJobs)) {
			return precedingJobs;
		}
	}
	return null;
}

function extractFailureSummary(job: CivitaiJobStatus): string {
	const context = job.lastEvent?.context;
	for (const key of ["error", "message", "reason"] as const) {
		const message = messageFromValue(context?.[key]);
		if (message) {
			return message;
		}
	}
	const eventType = getEventType(job);
	return eventType ? `Civitai job ${eventType}` : "Civitai job failed";
}

function normalizeJobCollection(
	body: CivitaiJobStatusCollection & Record<string, unknown>,
	endpointId: string,
	jobId: string
): InferenceJob {
	const jobs = Array.isArray(body.jobs) ? body.jobs : [];
	const failedJob = jobs.find((job) => {
		const eventType = getEventType(job);
		return eventType ? failedEventTypes.has(eventType) : false;
	});
	const allJobsSucceeded =
		jobs.length > 0 &&
		jobs.every(
			(job) => extractBlobUrl(job.result) || getEventType(job) === "Succeeded"
		);
	const anyRunning = jobs.some((job) => {
		const eventType = getEventType(job);
		return Boolean(
			(eventType && runningEventTypes.has(eventType)) || job.scheduled
		);
	});

	let status: InferenceStatus = "queued";
	if (failedJob) {
		status = "failed";
	} else if (allJobsSucceeded) {
		status = "succeeded";
	} else if (anyRunning) {
		status = "running";
	}

	const lastEventType = jobs
		.map(getEventType)
		.filter((eventType): eventType is string => eventType !== null)
		.at(-1);
	const queuePosition =
		jobs.map(extractQueuePosition).find((value) => value !== null) ?? null;

	return {
		endpointId,
		errorSummary: failedJob ? extractFailureSummary(failedJob) : null,
		jobId,
		lastLogLine: lastEventType ? `Civitai ${lastEventType}` : null,
		output: status === "succeeded" ? body : null,
		progressPct: status === "succeeded" ? 100 : null,
		queuePosition,
		status,
	};
}

export type CivitaiClient = InferenceClient;

export function createCivitaiClient(options: {
	apiBaseUrl?: string;
	apiKey: string;
	fetchImpl?: CivitaiFetch;
}): InferenceClient {
	const fetchImpl = options.fetchImpl ?? fetch;
	const apiBaseUrl = (
		options.apiBaseUrl ?? DEFAULT_CIVITAI_API_BASE_URL
	).replace(TRAILING_SLASH, "");

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
			if (!response.ok) {
				const message = extractErrorMessage(body ?? {}, response.status);
				throw new Error(`${label}: ${message}`);
			}
			return (body ?? {}) as T & Record<string, unknown>;
		} finally {
			clearTimeout(timeout);
		}
	};

	return {
		async submit(payload): Promise<InferenceSubmission> {
			const { model, requestBody } = buildCivitaiRequestBody(payload);
			const endpointId = formatCivitaiProviderEndpointId(model);
			const body = await request<CivitaiJobStatusCollection>(
				buildUrl(apiBaseUrl, "/v1/consumer/jobs", {
					detailed: "false",
					wait: "false",
				}),
				{
					body: JSON.stringify(requestBody),
					method: "POST",
				},
				"Civitai jobs.create"
			);
			const firstJob = Array.isArray(body.jobs) ? body.jobs[0] : undefined;
			const token = readStringField(body, "token") ?? firstJob?.jobId ?? null;
			if (!token) {
				throw new Error("Civitai jobs.create response did not include token");
			}
			const normalized = normalizeJobCollection(body, endpointId, token);
			return {
				endpointId,
				jobId: token,
				lastLogLine: normalized.lastLogLine,
				progressPct: normalized.progressPct,
				queuePosition: normalized.queuePosition,
				status: normalized.status,
			};
		},

		async getStatus(jobId, endpointId): Promise<InferenceJob> {
			if (!endpointId) {
				throw new Error(
					"Civitai provider requires endpointId for status check"
				);
			}
			parseCivitaiProviderEndpointId(endpointId);
			const body = await request<CivitaiJobStatusCollection>(
				buildUrl(apiBaseUrl, "/v1/consumer/jobs", {
					detailed: "false",
					token: jobId,
					wait: "false",
				}),
				undefined,
				"Civitai jobs.get"
			);
			return normalizeJobCollection(body, endpointId, jobId);
		},

		async cancel(jobId, endpointId): Promise<void> {
			if (!endpointId) {
				throw new Error(
					"Civitai provider requires endpointId for cancellation"
				);
			}
			parseCivitaiProviderEndpointId(endpointId);
			await request<Record<string, unknown>>(
				buildUrl(apiBaseUrl, "/v1/consumer/jobs", {
					force: "true",
					token: jobId,
				}),
				{ method: "DELETE" },
				"Civitai jobs.cancel"
			);
		},
	};
}
