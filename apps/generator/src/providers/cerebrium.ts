import type {
	InferenceClient,
	InferenceJob,
	InferenceSubmission,
} from "./inference";

const REQUEST_TIMEOUT_MS = 600_000;

export function createCerebriumClient(options: {
	apiKey: string;
	projectId: string;
	region?: string;
}): InferenceClient {
	const baseUrl = `https://api.${options.region ?? "aws.us-east-1"}.cerebrium.ai/v4/${options.projectId}`;
	const resultCache = new Map<string, Record<string, unknown>>();

	async function cerebriumFetch(
		url: string,
		body: Record<string, unknown>
	): Promise<Record<string, unknown>> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					authorization: `Bearer ${options.apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			const result = (await response.json()) as Record<string, unknown>;
			if (!response.ok) {
				const detail =
					typeof result.detail === "string"
						? result.detail
						: JSON.stringify(result);
				throw new Error(`Cerebrium API error (${response.status}): ${detail}`);
			}
			return result;
		} finally {
			clearTimeout(timeout);
		}
	}

	return {
		async submit(payload): Promise<InferenceSubmission> {
			const { __cerebriumApp, __cerebriumFunction, ...input } =
				payload as Record<string, unknown>;
			if (
				typeof __cerebriumApp !== "string" ||
				typeof __cerebriumFunction !== "string"
			) {
				throw new Error(
					"Cerebrium provider requires __cerebriumApp and __cerebriumFunction"
				);
			}

			const url = `${baseUrl}/${__cerebriumApp}/${__cerebriumFunction}`;
			const result = await cerebriumFetch(url, input);

			const runId =
				typeof result.run_id === "string" ? result.run_id : crypto.randomUUID();
			const endpointId = `${__cerebriumApp}/${__cerebriumFunction}`;
			const innerResult = (result.result ?? {}) as Record<string, unknown>;

			if (typeof innerResult.error === "string") {
				resultCache.set(runId, {
					error: innerResult.error,
				});
				return { endpointId, jobId: runId, status: "failed" };
			}

			resultCache.set(runId, innerResult);
			return { endpointId, jobId: runId, status: "succeeded" };
		},

		getStatus(jobId, endpointId): Promise<InferenceJob> {
			const cached = resultCache.get(jobId);
			resultCache.delete(jobId);

			if (cached && typeof cached.error === "string") {
				return Promise.resolve({
					endpointId: endpointId ?? "",
					errorSummary: cached.error,
					jobId,
					output: null,
					status: "failed",
				});
			}

			return Promise.resolve({
				endpointId: endpointId ?? "",
				errorSummary: null,
				jobId,
				output: cached ?? null,
				status: cached ? "succeeded" : "failed",
			});
		},

		cancel(): Promise<void> {
			return Promise.resolve();
		},
	};
}
