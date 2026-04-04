import { getComfyOperatorEnv } from "@generator/env/server";

const runpodRunStatusMap = {
	IN_QUEUE: "queued",
	IN_PROGRESS: "running",
	COMPLETED: "succeeded",
	FAILED: "failed",
} as const;
const trailingSlashPattern = /\/$/;

export type RunpodRunStatus =
	(typeof runpodRunStatusMap)[keyof typeof runpodRunStatusMap];

export interface RunpodSubmission {
	jobId: string;
	status: RunpodRunStatus;
}

export interface RunpodJob {
	errorSummary: string | null;
	jobId: string;
	output: unknown;
	status: RunpodRunStatus;
}

interface RunpodConfig {
	apiBaseUrl: string;
	apiKey: string;
	endpointId: string;
}

type RunpodFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function normalizeRunpodStatus(status: string): RunpodRunStatus {
	const normalized =
		runpodRunStatusMap[status as keyof typeof runpodRunStatusMap];
	if (!normalized) {
		throw new Error(`Unsupported Runpod status: ${status}`);
	}
	return normalized;
}

export function normalizeRunpodError(payload: unknown, fallbackStatus: number) {
	if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		const detail = [record.error, record.message, record.status].find(
			(value): value is string => typeof value === "string" && value.length > 0
		);
		if (detail) {
			return detail;
		}
	}
	return `Runpod request failed with status ${fallbackStatus}`;
}

export type RunpodClient = ReturnType<typeof createRunpodClient>;

export function createRunpodClient(options?: {
	apiKey?: string;
	endpointId?: string;
	apiBaseUrl?: string;
	fetchImpl?: RunpodFetch;
}) {
	const fetchImpl = options?.fetchImpl ?? fetch;

	const resolveConfig = (): RunpodConfig => {
		if (options?.apiKey && options?.endpointId) {
			return {
				apiKey: options.apiKey,
				endpointId: options.endpointId,
				apiBaseUrl: options.apiBaseUrl ?? "https://api.runpod.ai/v2",
			};
		}

		const env = getComfyOperatorEnv();
		return {
			apiKey: env.RUNPOD_API_KEY,
			endpointId: env.RUNPOD_ENDPOINT_ID,
			apiBaseUrl: options?.apiBaseUrl ?? env.RUNPOD_API_BASE_URL,
		};
	};

	const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
		const config = resolveConfig();
		const url = `${config.apiBaseUrl.replace(trailingSlashPattern, "")}/${config.endpointId}${path}`;
		const response = await fetchImpl(url, {
			...init,
			headers: {
				accept: "application/json",
				authorization: config.apiKey,
				"content-type": "application/json",
				...(init?.headers ?? {}),
			},
		});

		const payload = (await response.json().catch(() => null)) as T | null;
		if (!response.ok || payload === null) {
			throw new Error(normalizeRunpodError(payload, response.status));
		}

		return payload;
	};

	return {
		async submit(payload: Record<string, unknown>): Promise<RunpodSubmission> {
			const response = await request<{ id: string; status: string }>("/run", {
				method: "POST",
				body: JSON.stringify({ input: payload }),
			});

			return {
				jobId: response.id,
				status: normalizeRunpodStatus(response.status),
			};
		},
		async getStatus(jobId: string): Promise<RunpodJob> {
			const response = await request<{
				id: string;
				status: string;
				output?: unknown;
				error?: string;
				message?: string;
			}>(`/status/${jobId}`);
			let errorSummary: string | null = null;
			if (typeof response.error === "string") {
				errorSummary = response.error;
			} else if (typeof response.message === "string") {
				errorSummary = response.message;
			}

			return {
				jobId: response.id,
				status: normalizeRunpodStatus(response.status),
				output: response.output ?? null,
				errorSummary,
			};
		},
	};
}
