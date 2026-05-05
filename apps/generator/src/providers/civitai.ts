import type {
	InferenceClient,
	InferenceJob,
	InferenceStatus,
	InferenceSubmission,
} from "./inference";

const CIVITAI_ENDPOINT_ID_PREFIX = "civitai:";
const DEFAULT_CIVITAI_API_BASE_URL = "https://orchestration-new.civitai.com";
const CIVITAI_LTX_WORKFLOW_ENDPOINT_PREFIX = "ltx2.3:";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_VALIDATION_MESSAGES = 6;
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
const failedWorkflowStatuses = new Set(["canceled", "expired", "failed"]);
const runningWorkflowStatuses = new Set(["preparing", "processing"]);

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

interface CivitaiWorkflowStepJob {
	estimatedProgressRate?: number | null;
	queuePosition?: CivitaiQueuePosition | null;
	status?: string | null;
}

interface CivitaiWorkflowStep {
	estimatedProgressRate?: number | null;
	jobs?: CivitaiWorkflowStepJob[] | null;
	name?: string | null;
	output?: unknown;
	status?: string | null;
}

interface CivitaiWorkflow {
	id?: string | null;
	status?: string | null;
	steps?: CivitaiWorkflowStep[] | null;
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

function collectValidationErrors(value: unknown): string[] {
	if (!(value && typeof value === "object")) {
		return [];
	}
	if (Array.isArray(value)) {
		return value
			.map(messageFromValue)
			.filter((message): message is string => Boolean(message));
	}
	const messages: string[] = [];
	for (const [field, fieldValue] of Object.entries(value)) {
		const fieldMessages = Array.isArray(fieldValue)
			? fieldValue
					.map(messageFromValue)
					.filter((message): message is string => Boolean(message))
			: [messageFromValue(fieldValue)].filter((message): message is string =>
					Boolean(message)
				);
		if (fieldMessages.length > 0) {
			messages.push(`${field}: ${fieldMessages.join(", ")}`);
		}
	}
	return messages;
}

function extractErrorMessage(
	body: Record<string, unknown>,
	fallbackStatus: number
): string {
	const validationMessages = collectValidationErrors(body.errors);
	if (validationMessages.length > 0) {
		const title =
			messageFromValue(body.title) ??
			messageFromValue(body.message) ??
			"Validation failed.";
		const visibleMessages = validationMessages.slice(
			0,
			MAX_VALIDATION_MESSAGES
		);
		const suffix =
			validationMessages.length > visibleMessages.length
				? `; +${validationMessages.length - visibleMessages.length} more`
				: "";
		return `${title} ${visibleMessages.join("; ")}${suffix}`;
	}

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
	endpointKey: string;
	requestBody: Record<string, unknown>;
} {
	const { __civitaiEndpoint, __civitaiModel, ...requestBody } = payload;
	const endpointKey =
		typeof __civitaiEndpoint === "string" && __civitaiEndpoint.length > 0
			? __civitaiEndpoint
			: __civitaiModel;
	if (typeof endpointKey !== "string" || endpointKey.length === 0) {
		throw new Error(
			"Civitai provider requires __civitaiModel or __civitaiEndpoint in payload"
		);
	}
	return {
		endpointKey,
		requestBody:
			typeof __civitaiModel === "string" && __civitaiModel.length > 0
				? {
						model: __civitaiModel,
						...requestBody,
					}
				: requestBody,
	};
}

function isCivitaiWorkflowEndpointKey(endpointKey: string): boolean {
	return endpointKey.startsWith(CIVITAI_LTX_WORKFLOW_ENDPOINT_PREFIX);
}

function isCivitaiWorkflowEndpointId(endpointId: string): boolean {
	return isCivitaiWorkflowEndpointKey(
		parseCivitaiProviderEndpointId(endpointId)
	);
}

function buildCivitaiWorkflowRequestBody(
	step: Record<string, unknown>,
	endpointKey: string
): Record<string, unknown> {
	return {
		allowMatureContent: true,
		currencies: [],
		metadata: {
			endpointKey,
			source: "generator",
		},
		steps: [
			{
				name: "video",
				priority: "normal",
				retries: 1,
				...step,
			},
		],
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

function extractWorkflowQueuePosition(
	workflow: CivitaiWorkflow
): number | null {
	for (const step of workflow.steps ?? []) {
		for (const job of step.jobs ?? []) {
			const precedingJobs = job.queuePosition?.precedingJobs;
			if (typeof precedingJobs === "number" && Number.isFinite(precedingJobs)) {
				return precedingJobs;
			}
		}
	}
	return null;
}

function extractWorkflowProgress(workflow: CivitaiWorkflow): number | null {
	const progressValues = (workflow.steps ?? []).flatMap((step) => {
		const values: number[] = [];
		if (
			typeof step.estimatedProgressRate === "number" &&
			Number.isFinite(step.estimatedProgressRate)
		) {
			values.push(step.estimatedProgressRate);
		}
		for (const job of step.jobs ?? []) {
			if (
				typeof job.estimatedProgressRate === "number" &&
				Number.isFinite(job.estimatedProgressRate)
			) {
				values.push(job.estimatedProgressRate);
			}
		}
		return values;
	});
	if (progressValues.length === 0) {
		return null;
	}
	const average =
		progressValues.reduce((total, value) => total + value, 0) /
		progressValues.length;
	return Math.round(Math.min(1, Math.max(0, average)) * 100);
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

function normalizeWorkflowStatus(
	status: string | null | undefined
): InferenceStatus {
	if (status === "succeeded") {
		return "succeeded";
	}
	if (status && failedWorkflowStatuses.has(status)) {
		return "failed";
	}
	if (status && runningWorkflowStatuses.has(status)) {
		return "running";
	}
	return "queued";
}

function extractWorkflowFailureSummary(
	workflow: CivitaiWorkflow
): string | null {
	const failedStep = (workflow.steps ?? []).find((step) => {
		return step.status ? failedWorkflowStatuses.has(step.status) : false;
	});
	if (failedStep?.name) {
		return `Civitai workflow step ${failedStep.name} ${failedStep.status}`;
	}
	return workflow.status ? `Civitai workflow ${workflow.status}` : null;
}

function normalizeWorkflow(
	body: CivitaiWorkflow & Record<string, unknown>,
	endpointId: string,
	jobId: string
): InferenceJob {
	const status = normalizeWorkflowStatus(body.status);
	const progress = status === "succeeded" ? 100 : extractWorkflowProgress(body);
	const lastLogLine =
		typeof body.status === "string" && body.status.length > 0
			? `Civitai workflow ${body.status}`
			: null;

	return {
		endpointId,
		errorSummary:
			status === "failed" ? extractWorkflowFailureSummary(body) : null,
		jobId,
		lastLogLine,
		output: status === "succeeded" ? body : null,
		progressPct: progress,
		queuePosition: extractWorkflowQueuePosition(body),
		status,
	};
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
			const { endpointKey, requestBody } = buildCivitaiRequestBody(payload);
			const endpointId = formatCivitaiProviderEndpointId(endpointKey);
			if (isCivitaiWorkflowEndpointKey(endpointKey)) {
				const body = await request<CivitaiWorkflow>(
					buildUrl(apiBaseUrl, "/v2/consumer/workflows", {
						hideMatureContent: "false",
						wait: "0",
					}),
					{
						body: JSON.stringify(
							buildCivitaiWorkflowRequestBody(requestBody, endpointKey)
						),
						method: "POST",
					},
					"Civitai workflows.create"
				);
				const workflowId = readStringField(body, "id");
				if (!workflowId) {
					throw new Error(
						"Civitai workflows.create response did not include id"
					);
				}
				const normalized = normalizeWorkflow(body, endpointId, workflowId);
				return {
					endpointId,
					jobId: workflowId,
					lastLogLine: normalized.lastLogLine,
					progressPct: normalized.progressPct,
					queuePosition: normalized.queuePosition,
					status: normalized.status,
				};
			}
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
			if (isCivitaiWorkflowEndpointId(endpointId)) {
				const body = await request<CivitaiWorkflow>(
					buildUrl(apiBaseUrl, `/v2/consumer/workflows/${jobId}`, {
						hideMatureContent: "false",
						wait: "false",
					}),
					undefined,
					"Civitai workflows.get"
				);
				return normalizeWorkflow(body, endpointId, jobId);
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
			if (isCivitaiWorkflowEndpointId(endpointId)) {
				await request<Record<string, unknown>>(
					buildUrl(apiBaseUrl, `/v2/consumer/workflows/${jobId}`, {}),
					{ method: "DELETE" },
					"Civitai workflows.cancel"
				);
				return;
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
