import type {
	CreateGeneratorExecutionInput,
	GeneratorExecutionRecord,
	SyncGeneratorExecutionInput,
} from "@generator/contracts/generator";
import {
	DEBUG_CORRELATION_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeneratorExecutionRequestOptions {
	debugCorrelationId?: string;
}

async function requestJson<T>(
	fetchImpl: FetchLike,
	input: string,
	init?: RequestInit
): Promise<T> {
	const response = await fetchImpl(input, init);

	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`.trim());
	}

	return (await response.json()) as T;
}

export interface GeneratorExecutionClient {
	createExecution(
		input: CreateGeneratorExecutionInput,
		options?: GeneratorExecutionRequestOptions
	): Promise<GeneratorExecutionRecord>;
	getExecution(
		executionId: string,
		options?: GeneratorExecutionRequestOptions
	): Promise<GeneratorExecutionRecord>;
	syncExecution(
		input: SyncGeneratorExecutionInput,
		options?: GeneratorExecutionRequestOptions
	): Promise<GeneratorExecutionRecord>;
}

export function createGeneratorExecutionClient(
	baseUrl: string,
	fetchImpl: FetchLike = fetch
): GeneratorExecutionClient {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

	return {
		async createExecution(input, options) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await requestJson<{
				execution: GeneratorExecutionRecord;
			}>(fetchImpl, `${normalizedBaseUrl}/api/executions`, {
				body: JSON.stringify(input),
				headers: {
					"content-type": "application/json",
					[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				},
				method: "POST",
			});

			return payload.execution;
		},
		async getExecution(executionId, options) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await requestJson<{
				execution: GeneratorExecutionRecord;
			}>(fetchImpl, `${normalizedBaseUrl}/api/executions/${executionId}`, {
				headers: {
					[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				},
				method: "GET",
			});

			return payload.execution;
		},
		async syncExecution(input, options) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await requestJson<{
				execution: GeneratorExecutionRecord;
			}>(fetchImpl, `${normalizedBaseUrl}/api/executions/sync`, {
				body: JSON.stringify(input),
				headers: {
					"content-type": "application/json",
					[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				},
				method: "POST",
			});

			return payload.execution;
		},
	};
}
