import type { S3StorageConfig } from "@generator/storage";

import { createPodsApi, type RunpodPodsApi } from "../api/pods";
import {
	createServerlessApi,
	type RunpodServerlessApi,
} from "../api/serverless";
import type { Engine, EngineJob, EngineSubmission } from "../engine/engine";
import { createPodEngine } from "../engine/pod-engine";
import { createServerlessEngine } from "../engine/serverless-engine";
import type { InferenceStatus } from "../engine/status";
import type { PodInputStore, WarmPodPool } from "../engine/warm-pod-pool";
import {
	createRunpodHttpClient,
	type RunpodFetch,
	type RunpodHttpClient,
} from "../http/client";
import type {
	AnyWorkflowDefinition,
	PodWorkflow,
	ServerlessWorkflow,
} from "./definition";
import { createWorkflowRegistry, type WorkflowRegistry } from "./registry";

export const ENDPOINT_ID_PREFIX = "runpod:";
export const LEGACY_POD_ENDPOINT_ID_PREFIX = "runpod-pod:";
const DEFAULT_SERVERLESS_BASE_URL = "https://api.runpod.ai/v2";
const DEFAULT_PODS_BASE_URL = "https://rest.runpod.io/v1";

export interface RunpodSubmission {
	endpointId: string;
	jobId: string;
	queuePosition: number | null;
	status: InferenceStatus;
	workflowId: string;
}

export interface RunpodJob<TOutput = unknown> {
	endpointId: string;
	errorSummary: string | null;
	jobId: string;
	output: TOutput | null;
	progressPct: number | null;
	queuePosition: number | null;
	status: InferenceStatus;
	workflowId: string;
}

export interface CreateRunpodServiceOptions {
	apiKey: string;
	civitaiApiKey?: string;
	fetchImpl?: RunpodFetch;
	hfToken?: string;
	httpTimeoutMs?: number;
	/** Cross-process per-request input cache for warm-pod reuse. */
	inputStore?: PodInputStore;
	logger?: Pick<Console, "info" | "warn">;
	podsBaseUrl?: string;
	s3: S3StorageConfig;
	serverlessBaseUrl?: string;
	/** Warm-pod pool shared across worker processes (typically Redis-backed). */
	warmPool?: WarmPodPool;
	workflows: readonly AnyWorkflowDefinition[];
}

export interface RunpodService {
	cancel(input: { endpointId: string; jobId: string }): Promise<void>;
	getStatus(input: { endpointId: string; jobId: string }): Promise<RunpodJob>;
	/**
	 * Низкоуровневый pods API — exposed for the reaper / debug tooling that
	 * needs to list/terminate live RunPod inventory outside of the per-job
	 * engine state machine.
	 */
	podsApi: RunpodPodsApi;
	registry: WorkflowRegistry;
	submit<TInput>(input: {
		input: TInput;
		workflowId: string;
	}): Promise<RunpodSubmission>;
}

interface ResolvedEndpoint {
	mode: "serverless" | "pod";
	workflowId: string;
}

export function formatEndpointId(workflow: AnyWorkflowDefinition): string {
	return `${ENDPOINT_ID_PREFIX}${workflow.id}`;
}

/**
 * Парсер endpointId, который умеет читать:
 * 1. Канонический новый формат `runpod:<workflowId>`.
 * 2. Legacy `runpod:<rawEndpointId>` от старого serverless-провайдера —
 *    тогда workflowId резолвится через `legacyServerlessLookup`.
 * 3. Legacy `runpod-pod:<workflowId>` от старого pod-провайдера.
 */
export function parseEndpointId(
	endpointId: string,
	registry: WorkflowRegistry,
	legacyServerlessLookup?: (rawEndpointId: string) => string | undefined
): ResolvedEndpoint {
	if (endpointId.startsWith(LEGACY_POD_ENDPOINT_ID_PREFIX)) {
		const workflowId = endpointId.slice(LEGACY_POD_ENDPOINT_ID_PREFIX.length);
		const workflow = registry.get(workflowId);
		if (workflow.mode !== "pod") {
			throw new Error(
				`Endpoint ${endpointId} resolved to non-pod workflow ${workflowId}`
			);
		}
		return { mode: "pod", workflowId };
	}
	if (!endpointId.startsWith(ENDPOINT_ID_PREFIX)) {
		throw new Error(`Unrecognised RunPod endpointId: ${endpointId}`);
	}
	const tail = endpointId.slice(ENDPOINT_ID_PREFIX.length);
	if (registry.has(tail)) {
		const workflow = registry.get(tail);
		return { mode: workflow.mode, workflowId: tail };
	}
	const mappedWorkflowId = legacyServerlessLookup?.(tail);
	if (mappedWorkflowId && registry.has(mappedWorkflowId)) {
		const workflow = registry.get(mappedWorkflowId);
		if (workflow.mode !== "serverless") {
			throw new Error(
				`Legacy endpointId ${endpointId} mapped to non-serverless workflow ${mappedWorkflowId}`
			);
		}
		return { mode: "serverless", workflowId: mappedWorkflowId };
	}
	throw new Error(
		`No RunPod workflow matches endpointId ${endpointId}; expected one of [${registry
			.list()
			.map((wf) => wf.id)
			.join(", ")}]`
	);
}

interface BuildEnginesContext {
	civitaiApiKey?: string;
	hfToken?: string;
	inputStore?: PodInputStore;
	logger?: Pick<Console, "info" | "warn">;
	podsApi: RunpodPodsApi;
	s3: S3StorageConfig;
	serverlessApi: RunpodServerlessApi;
	warmPool?: WarmPodPool;
}

function buildEngine(
	workflow: AnyWorkflowDefinition,
	ctx: BuildEnginesContext
): Engine<unknown, unknown> {
	if (workflow.mode === "serverless") {
		return createServerlessEngine({
			api: ctx.serverlessApi,
			workflow: workflow as ServerlessWorkflow<unknown, unknown>,
		});
	}
	return createPodEngine({
		api: ctx.podsApi,
		civitaiApiKey: ctx.civitaiApiKey,
		hfToken: ctx.hfToken,
		inputStore: ctx.inputStore,
		logger: ctx.logger,
		s3: ctx.s3,
		warmPool: ctx.warmPool,
		workflow: workflow as PodWorkflow<unknown, unknown>,
	});
}

export function createRunpodService(
	options: CreateRunpodServiceOptions
): RunpodService {
	const registry = createWorkflowRegistry(options.workflows);
	const serverlessHttp = buildHttp({
		apiKey: options.apiKey,
		baseUrl: options.serverlessBaseUrl ?? DEFAULT_SERVERLESS_BASE_URL,
		fetchImpl: options.fetchImpl,
		timeoutMs: options.httpTimeoutMs,
	});
	const podsHttp = buildHttp({
		apiKey: options.apiKey,
		baseUrl: options.podsBaseUrl ?? DEFAULT_PODS_BASE_URL,
		fetchImpl: options.fetchImpl,
		timeoutMs: options.httpTimeoutMs,
	});
	const serverlessApi = createServerlessApi(serverlessHttp);
	const podsApi = createPodsApi(podsHttp);

	const engines = new Map<string, Engine<unknown, unknown>>();
	const engineFor = (workflowId: string): Engine<unknown, unknown> => {
		const cached = engines.get(workflowId);
		if (cached) {
			return cached;
		}
		const workflow = registry.get(workflowId);
		const engine = buildEngine(workflow, {
			civitaiApiKey: options.civitaiApiKey,
			hfToken: options.hfToken,
			inputStore: options.inputStore,
			logger: options.logger,
			podsApi,
			s3: options.s3,
			serverlessApi,
			warmPool: options.warmPool,
		});
		engines.set(workflowId, engine);
		return engine;
	};

	const legacyServerlessLookup = (
		rawEndpointId: string
	): string | undefined => {
		for (const workflow of registry.list()) {
			if (
				workflow.mode === "serverless" &&
				workflow.endpointId === rawEndpointId
			) {
				return workflow.id;
			}
		}
		return;
	};

	return {
		async cancel({ endpointId, jobId }) {
			const { workflowId } = parseEndpointId(
				endpointId,
				registry,
				legacyServerlessLookup
			);
			await engineFor(workflowId).cancel(jobId);
		},

		async getStatus({ endpointId, jobId }) {
			const { workflowId } = parseEndpointId(
				endpointId,
				registry,
				legacyServerlessLookup
			);
			const engine = engineFor(workflowId);
			const job: EngineJob & { output: unknown } =
				await engine.getStatus(jobId);
			return {
				endpointId: formatEndpointId(registry.get(workflowId)),
				errorSummary: job.errorSummary,
				jobId: job.jobId,
				output: job.output,
				progressPct: job.progressPct,
				queuePosition: job.queuePosition,
				status: job.status,
				workflowId,
			};
		},

		podsApi,
		registry,

		async submit({ input, workflowId }): Promise<RunpodSubmission> {
			const workflow = registry.get(workflowId);
			const engine = engineFor(workflowId);
			const submission: EngineSubmission = await engine.submit(input);
			return {
				endpointId: formatEndpointId(workflow),
				jobId: submission.jobId,
				queuePosition: submission.queuePosition,
				status: submission.status,
				workflowId,
			};
		},
	};
}

function buildHttp(options: {
	apiKey: string;
	baseUrl: string;
	fetchImpl?: RunpodFetch;
	timeoutMs?: number;
}): RunpodHttpClient {
	return createRunpodHttpClient({
		apiKey: options.apiKey,
		baseUrl: options.baseUrl,
		fetchImpl: options.fetchImpl,
		timeoutMs: options.timeoutMs,
	});
}
