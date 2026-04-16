import type {
	CreateGeneratorExecutionInput,
	GeneratorExecutionRecord,
	GeneratorHealthResponse,
	SyncGeneratorExecutionInput,
} from "@generator/contracts/generator";
import {
	DEBUG_CORRELATION_HEADER,
	GENERATOR_INTERNAL_TOKEN_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeneratorExecutionRequestOptions {
	debugCorrelationId?: string;
}

export interface GeneratorExecutionClientOptions {
	fetchImpl?: FetchLike;
	/**
	 * Токен для приватных внутренних запросов между сервисами.
	 * Если задан — будет отправляться в заголовке
	 * `x-generator-internal-token` на каждом запросе.
	 */
	internalToken?: string;
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
	getHealth(
		options?: GeneratorExecutionRequestOptions
	): Promise<GeneratorHealthResponse>;
	syncExecution(
		input: SyncGeneratorExecutionInput,
		options?: GeneratorExecutionRequestOptions
	): Promise<GeneratorExecutionRecord>;
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

function isGeneratorHealthResponse(
	value: unknown
): value is GeneratorHealthResponse {
	return Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as { ok?: unknown }).ok === "boolean" &&
			typeof (value as { workflows?: unknown }).workflows === "number"
	);
}

export function createGeneratorExecutionClient(
	baseUrl: string,
	fetchImplOrOptions: FetchLike | GeneratorExecutionClientOptions = {}
): GeneratorExecutionClient {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const resolvedOptions: GeneratorExecutionClientOptions =
		typeof fetchImplOrOptions === "function"
			? { fetchImpl: fetchImplOrOptions }
			: fetchImplOrOptions;
	const fetchImpl = resolvedOptions.fetchImpl ?? fetch;
	const internalToken = resolvedOptions.internalToken?.trim();

	function buildHeaders(
		correlationId: string,
		extra?: Record<string, string>
	): Record<string, string> {
		const headers: Record<string, string> = {
			accept: "application/json",
			[DEBUG_CORRELATION_HEADER]: correlationId,
		};
		if (internalToken) {
			headers[GENERATOR_INTERNAL_TOKEN_HEADER] = internalToken;
		}
		if (extra) {
			Object.assign(headers, extra);
		}
		return headers;
	}

	return {
		async createExecution(input, options) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await requestJson<{
				execution: GeneratorExecutionRecord;
			}>(fetchImpl, `${normalizedBaseUrl}/api/executions`, {
				body: JSON.stringify(input),
				headers: buildHeaders(debugCorrelationId, {
					"content-type": "application/json",
				}),
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
				headers: buildHeaders(debugCorrelationId),
				method: "GET",
			});

			return payload.execution;
		},
		async getHealth(options) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await requestJson<unknown>(
				fetchImpl,
				`${normalizedBaseUrl}/api/health`,
				{
					headers: buildHeaders(debugCorrelationId),
					method: "GET",
				}
			);

			if (!isGeneratorHealthResponse(payload)) {
				throw new Error("Unexpected generator health payload");
			}

			return payload;
		},
		async syncExecution(input, options) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await requestJson<{
				execution: GeneratorExecutionRecord;
			}>(fetchImpl, `${normalizedBaseUrl}/api/executions/sync`, {
				body: JSON.stringify(input),
				headers: buildHeaders(debugCorrelationId, {
					"content-type": "application/json",
				}),
				method: "POST",
			});

			return payload.execution;
		},
	};
}
