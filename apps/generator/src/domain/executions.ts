import type {
	CreateGeneratorExecutionInput,
	GeneratorExecutionRecord,
	SyncGeneratorExecutionInput,
} from "@generator/contracts/generator";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";
import { getWorkflowDefinition, listWorkflows } from "@generator/workflows";
import { z } from "zod";

import type { InferenceClient } from "@/providers/inference";
import type { StorageAdapter } from "@/providers/storage";
import type { GeneratorExecutionQueue } from "@/queue/executions";
import { BadRequestError } from "@/routes/utils";

export const createExecutionInputSchema = z.object({
	callback: z
		.object({
			context: z.record(z.string(), z.unknown()).optional(),
			token: z.string().trim().min(1).optional(),
			url: z.url(),
		})
		.optional(),
	inputImageUrl: z.string().trim().min(1).optional(),
	params: z.record(z.string(), z.unknown()).default({}),
	prompt: z.string().trim().min(1, "Prompt is required"),
	workflowKey: z.string().trim().min(1, "Workflow key is required"),
});

export const syncExecutionInputSchema = z.object({
	providerEndpointId: z.string().trim().min(1).optional(),
	providerJobId: z.string().trim().min(1, "Provider job id is required"),
	workflowKey: z.string().trim().min(1, "Workflow key is required"),
});

type ExecutionLogger = Pick<Console, "info" | "error">;

interface ExecutionContext {
	debugCorrelationId?: string;
}

const STUCK_QUEUE_RESUBMIT_AFTER_MS = 2 * 60_000;
const STUCK_QUEUE_FAIL_AFTER_MS = 15 * 60_000;
const DEFAULT_RUNNING_SYNC_DELAY_MS = 10_000;
const DEFAULT_QUEUED_SYNC_DELAY_MS = 10_000;
const MEDIUM_QUEUED_SYNC_DELAY_MS = 20_000;
const LONG_QUEUED_SYNC_DELAY_MS = 30_000;

function getNextSyncDelay(
	status: GeneratorExecutionRecord["status"],
	queuedForMs: number
) {
	if (status === "running") {
		return DEFAULT_RUNNING_SYNC_DELAY_MS;
	}
	if (status !== "queued") {
		return DEFAULT_QUEUED_SYNC_DELAY_MS;
	}
	if (queuedForMs >= STUCK_QUEUE_RESUBMIT_AFTER_MS) {
		return LONG_QUEUED_SYNC_DELAY_MS;
	}
	if (queuedForMs >= 60_000) {
		return MEDIUM_QUEUED_SYNC_DELAY_MS;
	}
	return DEFAULT_QUEUED_SYNC_DELAY_MS;
}

function getExecutionProgressPct(status: GeneratorExecutionRecord["status"]) {
	switch (status) {
		case "queued":
			return 5;
		case "running":
			return 65;
		case "succeeded":
		case "failed":
			return 100;
		default:
			return 0;
	}
}

export interface ExecutionEntity {
	artifacts: Array<{ url: string | null }>;
	callback: {
		context?: Record<string, unknown>;
		token?: string;
		url: string;
	} | null;
	createdAt: Date;
	errorSummary: string | null;
	id: string;
	inputImageUrl: string | null;
	params: Record<string, unknown>;
	prompt: string;
	providerEndpointId: string | null;
	providerJobId: string | null;
	status: GeneratorExecutionRecord["status"];
	updatedAt: Date;
	workflowKey: string;
}

export interface ExecutionRepository {
	createExecution(
		input: Omit<ExecutionEntity, "createdAt" | "updatedAt">
	): Promise<ExecutionEntity>;
	getExecutionById(executionId: string): Promise<ExecutionEntity | null>;
	updateExecution(
		executionId: string,
		input: Partial<Omit<ExecutionEntity, "createdAt" | "updatedAt" | "id">>
	): Promise<ExecutionEntity | null>;
}

function toExecutionRecord(entity: ExecutionEntity): GeneratorExecutionRecord {
	return {
		artifacts: entity.artifacts,
		errorSummary: entity.errorSummary,
		id: entity.id,
		inputImageUrl: entity.inputImageUrl ?? "",
		providerEndpointId: entity.providerEndpointId,
		providerJobId: entity.providerJobId,
		progressPct: getExecutionProgressPct(entity.status),
		status: entity.status,
		workflowKey: entity.workflowKey,
	};
}

function normalizeDirectExecution(input: {
	artifacts?: string[];
	errorSummary?: string | null;
	inputImageUrl?: string;
	providerEndpointId?: string | null;
	providerJobId?: string | null;
	status: GeneratorExecutionRecord["status"];
	workflowKey: string;
}): GeneratorExecutionRecord {
	return {
		artifacts: (input.artifacts ?? []).map((url) => ({ url })),
		errorSummary: input.errorSummary ?? null,
		id: input.providerJobId ?? crypto.randomUUID(),
		inputImageUrl: input.inputImageUrl ?? "",
		providerEndpointId: input.providerEndpointId ?? null,
		providerJobId: input.providerJobId ?? null,
		progressPct: getExecutionProgressPct(input.status),
		status: input.status,
		workflowKey: input.workflowKey,
	};
}

export class ExecutionService {
	private readonly repository: ExecutionRepository;
	private readonly queue: GeneratorExecutionQueue;
	private readonly inferenceClient: InferenceClient;
	private readonly storageAdapter: StorageAdapter;
	private readonly logger: ExecutionLogger;

	constructor(
		repository: ExecutionRepository,
		queue: GeneratorExecutionQueue,
		inferenceClient: InferenceClient,
		storageAdapter: StorageAdapter,
		logger: ExecutionLogger = console
	) {
		this.repository = repository;
		this.queue = queue;
		this.inferenceClient = inferenceClient;
		this.storageAdapter = storageAdapter;
		this.logger = logger;
	}

	private buildSubmissionPayload(
		execution: ExecutionEntity,
		workflow: NonNullable<ReturnType<typeof getWorkflowDefinition>>
	) {
		return workflow.buildProviderInput({
			inputImageUrl: execution.inputImageUrl ?? undefined,
			params: workflow.parameterSchema.parse(execution.params) as never,
			prompt: execution.prompt,
		});
	}

	listWorkflows() {
		return listWorkflows();
	}

	async createExecution(
		input: CreateGeneratorExecutionInput,
		context?: ExecutionContext
	): Promise<GeneratorExecutionRecord> {
		const parsed = createExecutionInputSchema.parse(input);
		const workflow = getWorkflowDefinition(parsed.workflowKey);

		if (!workflow) {
			throw new BadRequestError(`Unknown workflow key: ${parsed.workflowKey}`);
		}
		if (workflow.requiresInputImage && !parsed.inputImageUrl) {
			throw new BadRequestError(
				`Workflow ${parsed.workflowKey} requires an input image URL`
			);
		}

		const normalizedInputImageUrl =
			workflow.requiresInputImage && parsed.inputImageUrl
				? this.storageAdapter.normalizeInputImageUrl(parsed.inputImageUrl)
				: null;
		const normalizedParams = workflow.parameterSchema.parse(
			parsed.params
		) as Record<string, unknown>;

		const execution = await this.repository.createExecution({
			artifacts: [],
			callback: parsed.callback ?? null,
			errorSummary: null,
			id: crypto.randomUUID(),
			inputImageUrl: normalizedInputImageUrl,
			params: normalizedParams,
			providerEndpointId: null,
			providerJobId: null,
			prompt: parsed.prompt,
			status: "queued",
			workflowKey: parsed.workflowKey,
		});

		this.logger.info("generator.execution.accepted", {
			debugCorrelationId: context?.debugCorrelationId ?? null,
			executionId: execution.id,
			workflowKey: execution.workflowKey,
		});

		await this.queue.enqueueSubmit({ executionId: execution.id });
		return toExecutionRecord(execution);
	}

	async getExecution(
		executionId: string
	): Promise<GeneratorExecutionRecord | null> {
		const execution = await this.repository.getExecutionById(executionId);
		return execution ? toExecutionRecord(execution) : null;
	}

	async cancelExecution(
		executionId: string,
		context?: ExecutionContext
	): Promise<GeneratorExecutionRecord | null> {
		const execution = await this.repository.getExecutionById(executionId);
		if (!execution) {
			return null;
		}

		if (execution.status === "succeeded" || execution.status === "failed") {
			return toExecutionRecord(execution);
		}

		if (execution.providerJobId) {
			try {
				await this.inferenceClient.cancel(
					execution.providerJobId,
					execution.providerEndpointId ?? undefined
				);
			} catch (error) {
				this.logger.error("generator.execution.cancel-provider-failed", {
					error: error instanceof Error ? error.message : "unknown",
					executionId: execution.id,
					providerJobId: execution.providerJobId,
				});
			}
		}

		const updatedExecution = await this.repository.updateExecution(
			execution.id,
			{
				errorSummary: "Execution cancelled by operator",
				status: "failed",
			}
		);

		if (!updatedExecution) {
			return toExecutionRecord(execution);
		}

		this.logger.info("generator.execution.cancelled", {
			debugCorrelationId: context?.debugCorrelationId ?? null,
			executionId: execution.id,
			providerJobId: execution.providerJobId,
			workflowKey: execution.workflowKey,
		});

		await this.dispatchExecutionCallback(updatedExecution);
		return toExecutionRecord(updatedExecution);
	}

	async syncExecution(
		input: SyncGeneratorExecutionInput,
		context?: ExecutionContext
	): Promise<GeneratorExecutionRecord> {
		const parsed = syncExecutionInputSchema.parse(input);
		const workflow = getWorkflowDefinition(parsed.workflowKey);

		if (!workflow) {
			throw new Error(`Unknown workflow key: ${parsed.workflowKey}`);
		}

		const job = await this.inferenceClient.getStatus(
			parsed.providerJobId,
			parsed.providerEndpointId
		);
		const artifacts = workflow
			.extractArtifactUrls(job.output)
			.map((url) => this.storageAdapter.normalizeOutputUrl(url));

		this.logger.info("generator.execution.status", {
			debugCorrelationId: context?.debugCorrelationId ?? null,
			providerEndpointId: job.endpointId,
			providerJobId: job.jobId,
			status: job.status,
		});

		return normalizeDirectExecution({
			artifacts,
			errorSummary: job.errorSummary,
			providerEndpointId: job.endpointId,
			providerJobId: job.jobId,
			status: job.status,
			workflowKey: parsed.workflowKey,
		});
	}

	private async dispatchExecutionCallback(execution: ExecutionEntity) {
		if (!execution.callback) {
			return;
		}

		const headers = new Headers({
			"content-type": "application/json",
		});
		if (execution.callback.token) {
			headers.set(GENERATOR_CALLBACK_TOKEN_HEADER, execution.callback.token);
		}

		try {
			const response = await fetch(execution.callback.url, {
				body: JSON.stringify({
					context: execution.callback.context ?? {},
					execution: toExecutionRecord(execution),
				}),
				headers,
				method: "POST",
			});
			if (!response.ok) {
				this.logger.error("generator.callback.failed", {
					executionId: execution.id,
					status: response.status,
					url: execution.callback.url,
				});
			}
		} catch (error) {
			this.logger.error("generator.callback.error", {
				executionId: execution.id,
				message: error instanceof Error ? error.message : "unknown error",
				url: execution.callback.url,
			});
		}
	}

	async markExecutionFailed(executionId: string, errorSummary: string) {
		const updated = await this.repository.updateExecution(executionId, {
			errorSummary,
			status: "failed",
		});
		if (updated) {
			await this.dispatchExecutionCallback(updated);
		}
	}

	async processExecutionSubmitJob(input: { executionId: string }) {
		const execution = await this.repository.getExecutionById(input.executionId);
		if (
			!execution ||
			execution.providerJobId ||
			execution.status !== "queued"
		) {
			return;
		}

		const workflow = getWorkflowDefinition(execution.workflowKey);
		if (!workflow) {
			await this.repository.updateExecution(execution.id, {
				errorSummary: `Unknown workflow key: ${execution.workflowKey}`,
				status: "failed",
			});
			return;
		}

		const submission = await this.inferenceClient.submit(
			this.buildSubmissionPayload(execution, workflow)
		);

		if (submission.status === "succeeded" || submission.status === "failed") {
			const job = await this.inferenceClient.getStatus(
				submission.jobId,
				submission.endpointId
			);
			const artifacts = workflow.extractArtifactUrls(job.output).map((url) => ({
				url: this.storageAdapter.normalizeOutputUrl(url),
			}));
			const finalExecution = await this.repository.updateExecution(
				execution.id,
				{
					artifacts,
					errorSummary: job.errorSummary,
					providerEndpointId: submission.endpointId,
					providerJobId: submission.jobId,
					status: submission.status,
				}
			);
			if (finalExecution) {
				await this.dispatchExecutionCallback(finalExecution);
			}
			return;
		}

		const updatedExecution = await this.repository.updateExecution(
			execution.id,
			{
				providerEndpointId: submission.endpointId,
				providerJobId: submission.jobId,
				status: submission.status,
			}
		);
		if (!updatedExecution) {
			return;
		}
		await this.dispatchExecutionCallback(updatedExecution);

		await this.queue.enqueueSync({
			delayMs: getNextSyncDelay(submission.status, 0),
			executionId: execution.id,
		});
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sync worker state machine
	async processExecutionSyncJob(input: { executionId: string }) {
		const execution = await this.repository.getExecutionById(input.executionId);
		if (
			!execution?.providerJobId ||
			execution.status === "succeeded" ||
			execution.status === "failed"
		) {
			return;
		}

		const workflow = getWorkflowDefinition(execution.workflowKey);
		if (!workflow) {
			await this.repository.updateExecution(execution.id, {
				errorSummary: `Unknown workflow key: ${execution.workflowKey}`,
				status: "failed",
			});
			return;
		}

		const job = await this.inferenceClient.getStatus(
			execution.providerJobId,
			execution.providerEndpointId ?? undefined
		);
		const now = Date.now();
		const queuedForMs = now - execution.updatedAt.getTime();
		const totalLifetimeMs = now - execution.createdAt.getTime();
		const nextArtifacts = workflow
			.extractArtifactUrls(job.output)
			.map((url) => ({ url: this.storageAdapter.normalizeOutputUrl(url) }));
		const artifactsChanged =
			execution.artifacts.length !== nextArtifacts.length ||
			execution.artifacts.some((a, i) => a.url !== nextArtifacts[i]?.url);
		const shouldDispatchCallback =
			execution.status !== job.status ||
			execution.providerJobId !== job.jobId ||
			execution.providerEndpointId !== job.endpointId ||
			execution.errorSummary !== job.errorSummary ||
			artifactsChanged;

		if (
			job.status === "queued" &&
			!shouldDispatchCallback &&
			queuedForMs >= STUCK_QUEUE_RESUBMIT_AFTER_MS
		) {
			if (totalLifetimeMs >= STUCK_QUEUE_FAIL_AFTER_MS) {
				const failedExecution = await this.repository.updateExecution(
					execution.id,
					{
						errorSummary:
							"Execution stayed queued too long. The worker pool is likely unhealthy.",
						status: "failed",
					}
				);
				if (failedExecution) {
					await this.dispatchExecutionCallback(failedExecution);
				}
				return;
			}

			await this.inferenceClient.cancel(
				execution.providerJobId,
				execution.providerEndpointId ?? undefined
			);
			const resubmission = await this.inferenceClient.submit(
				this.buildSubmissionPayload(execution, workflow)
			);
			const resubmittedExecution = await this.repository.updateExecution(
				execution.id,
				{
					errorSummary: null,
					providerEndpointId: resubmission.endpointId,
					providerJobId: resubmission.jobId,
					status: resubmission.status,
				}
			);
			if (resubmittedExecution) {
				await this.dispatchExecutionCallback(resubmittedExecution);
			}
			await this.queue.enqueueSync({
				delayMs: getNextSyncDelay(resubmission.status, 0),
				executionId: execution.id,
			});
			return;
		}

		const updatedExecution = shouldDispatchCallback
			? await this.repository.updateExecution(execution.id, {
					artifacts: nextArtifacts,
					errorSummary: job.errorSummary,
					providerEndpointId: job.endpointId,
					providerJobId: job.jobId,
					status: job.status,
				})
			: execution;
		if (!updatedExecution) {
			return;
		}
		if (
			shouldDispatchCallback ||
			job.status === "succeeded" ||
			job.status === "failed"
		) {
			await this.dispatchExecutionCallback(updatedExecution);
		}

		if (job.status === "queued" || job.status === "running") {
			await this.queue.enqueueSync({
				delayMs: getNextSyncDelay(job.status, queuedForMs),
				executionId: execution.id,
			});
		}
	}
}
