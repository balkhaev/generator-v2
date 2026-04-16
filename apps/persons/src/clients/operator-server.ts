import type {
	CreateGeneratorExecutionInput,
	GeneratorArtifactRecord,
	GeneratorExecutionRecord,
	GeneratorHealthResponse,
	GeneratorRunRecord,
	SyncGeneratorExecutionInput,
} from "@generator/contracts/generator";
import {
	DEBUG_CORRELATION_HEADER,
	GENERATOR_INTERNAL_TOKEN_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import type {
	OperatorServerClient,
	OperatorServerScenarioRecord,
} from "@/domain/persons";

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

const healthSchema = {
	parse(value: unknown): GeneratorHealthResponse {
		if (
			value &&
			typeof value === "object" &&
			typeof (value as { ok?: unknown }).ok === "boolean" &&
			typeof (value as { workflows?: unknown }).workflows === "number"
		) {
			return {
				ok: (value as { ok: boolean }).ok,
				workflows: (value as { workflows: number }).workflows,
			};
		}

		throw new Error("Unexpected operator health payload");
	},
};

function assertString(value: unknown, message: string) {
	if (typeof value === "string" && value.trim().length > 0) {
		return value;
	}

	throw new Error(message);
}

function assertNullableString(value: unknown) {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readString(value: unknown, fallback = "") {
	return typeof value === "string" ? value : fallback;
}

function readNullableNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapRunPayload(value: unknown): GeneratorRunRecord {
	if (!(value && typeof value === "object")) {
		throw new Error("Unexpected operator run payload");
	}

	const run = (value as { run?: unknown }).run;
	if (!(run && typeof run === "object")) {
		throw new Error("Operator server response did not include a run");
	}

	const artifacts: GeneratorArtifactRecord[] = Array.isArray(
		(run as { artifacts?: unknown }).artifacts
	)
		? ((run as { artifacts: unknown[] }).artifacts ?? []).flatMap(
				(artifact) => {
					if (
						artifact &&
						typeof artifact === "object" &&
						typeof (artifact as { url?: unknown }).url === "string"
					) {
						return [{ url: (artifact as { url: string }).url }];
					}

					return [];
				}
			)
		: [];

	return {
		artifacts,
		id: assertString(
			(run as { id?: unknown }).id,
			"Operator run id is missing"
		),
		inputImageUrl: readString(
			(run as { inputImageUrl?: unknown }).inputImageUrl
		),
		scenarioId: assertString(
			(run as { scenarioId?: unknown }).scenarioId,
			"Operator run scenario id is missing"
		),
		status: assertString(
			(run as { status?: unknown }).status,
			"Operator run status is missing"
		) as GeneratorRunRecord["status"],
		workflowKey: assertString(
			(run as { workflowKey?: unknown }).workflowKey,
			"Operator run workflow key is missing"
		),
	};
}

function mapScenarioPayload(value: unknown): OperatorServerScenarioRecord {
	if (!(value && typeof value === "object")) {
		throw new Error("Unexpected operator scenario payload");
	}

	const scenario = (value as { scenario?: unknown }).scenario;
	if (!(scenario && typeof scenario === "object")) {
		throw new Error("Operator server response did not include a scenario");
	}

	return {
		id: assertString(
			(scenario as { id?: unknown }).id,
			"Operator scenario id is missing"
		),
		name: assertString(
			(scenario as { name?: unknown }).name,
			"Operator scenario name is missing"
		),
		prompt: assertString(
			(scenario as { prompt?: unknown }).prompt,
			"Operator scenario prompt is missing"
		),
	};
}

export function createOperatorServerClient(
	baseUrl: string,
	options: {
		fetchImpl?: FetchLike;
		internalToken?: string;
	} = {}
): OperatorServerClient {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const fetchImpl = options.fetchImpl ?? fetch;
	const internalToken = options.internalToken?.trim();

	async function request(path: string, init?: RequestInit) {
		const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
			...init,
			headers: {
				accept: "application/json",
				...(internalToken
					? { [GENERATOR_INTERNAL_TOKEN_HEADER]: internalToken }
					: {}),
				...(init?.headers ?? {}),
			},
		});

		if (!response.ok) {
			throw new Error(`Operator server request failed: ${response.status}`);
		}

		return response.json();
	}

	return {
		async createExecution(
			input: CreateGeneratorExecutionInput,
			options?: {
				debugCorrelationId?: string;
			}
		) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await request("/api/executions", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				},
				body: JSON.stringify(input),
			});
			return mapExecutionPayload(payload);
		},
		async getExecution(
			executionId: string,
			options?: {
				debugCorrelationId?: string;
			}
		) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await request(`/api/executions/${executionId}`, {
				method: "GET",
				headers: {
					[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				},
			});
			return mapExecutionPayload(payload);
		},
		async syncExecution(
			input: SyncGeneratorExecutionInput,
			options?: {
				debugCorrelationId?: string;
			}
		) {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options?.debugCorrelationId,
			});
			const payload = await request("/api/executions/sync", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				},
				body: JSON.stringify(input),
			});
			return mapExecutionPayload(payload);
		},
		async getHealth() {
			return healthSchema.parse(await request("/api/health"));
		},
		async getRun(runId) {
			return mapRunPayload(await request(`/api/runs/${runId}`));
		},
		async getScenario(scenarioId) {
			return mapScenarioPayload(await request(`/api/scenarios/${scenarioId}`));
		},
	};
}

function mapExecutionPayload(value: unknown): GeneratorExecutionRecord {
	if (!(value && typeof value === "object")) {
		throw new Error("Unexpected generator execution payload");
	}

	const execution = (value as { execution?: unknown }).execution;
	if (!(execution && typeof execution === "object")) {
		throw new Error("Generator response did not include an execution");
	}

	const artifacts: GeneratorArtifactRecord[] = Array.isArray(
		(execution as { artifacts?: unknown }).artifacts
	)
		? ((execution as { artifacts: unknown[] }).artifacts ?? []).flatMap(
				(artifact) => {
					if (
						artifact &&
						typeof artifact === "object" &&
						typeof (artifact as { url?: unknown }).url === "string"
					) {
						return [{ url: (artifact as { url: string }).url }];
					}

					return [];
				}
			)
		: [];

	return {
		artifacts,
		errorSummary:
			typeof (execution as { errorSummary?: unknown }).errorSummary === "string"
				? (execution as { errorSummary: string }).errorSummary
				: null,
		id: assertString(
			(execution as { id?: unknown }).id,
			"Generator execution id is missing"
		),
		inputImageUrl: readString(
			(execution as { inputImageUrl?: unknown }).inputImageUrl
		),
		providerEndpointId: assertNullableString(
			(execution as { providerEndpointId?: unknown }).providerEndpointId
		),
		providerJobId: assertNullableString(
			(execution as { providerJobId?: unknown }).providerJobId
		),
		progressPct: readNullableNumber(
			(execution as { progressPct?: unknown }).progressPct
		),
		status: assertString(
			(execution as { status?: unknown }).status,
			"Generator execution status is missing"
		) as GeneratorExecutionRecord["status"],
		workflowKey: assertString(
			(execution as { workflowKey?: unknown }).workflowKey,
			"Generator execution workflow key is missing"
		),
	};
}
