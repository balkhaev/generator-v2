import type {
	CreateGeneratorExecutionInput,
	ExecutionPhase,
	GeneratorExecutionRecord,
	SyncGeneratorExecutionInput,
} from "@generator/contracts/generator";
import type { EventPublisher } from "@generator/events";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";
import {
	getWorkflowDefinition,
	getWorkflowExpectedDurationMs,
	listWorkflows,
} from "@generator/workflows";
import { z } from "zod";

import type {
	InferenceClient,
	InferenceJob,
	InferenceStreamHandle,
	InferenceSubmission,
} from "@/providers/inference";
import { isNonRetryableInferenceError } from "@/providers/inference";
import type { StorageAdapter } from "@/providers/storage";
import type { GeneratorExecutionQueue } from "@/queue/executions";
import { BadRequestError } from "@/routes/utils";

export const createExecutionInputSchema = z.object({
	callback: z
		.object({
			context: z.record(z.string(), z.unknown()).optional(),
			token: z.string().trim().min(1).optional(),
			url: z.url().optional(),
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

// Заметка: для RunPod serverless с большими volume-моделями (LTX) cold-start
// pickup может быть 60-180с, а сам inference 5-10 мин. Если workersMax=2 и
// приходит третий job — он легко зависает в queue >10 мин просто ожидая
// освобождения worker. Поэтому держим resubmit высоким (15 мин) и fail-порог
// 30 мин по умолчанию. Оба значения можно переопределить через env для
// конкретных провайдеров.
function readEnvMs(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return parsed;
}

const STUCK_QUEUE_RESUBMIT_AFTER_MS = readEnvMs(
	"GENERATOR_STUCK_QUEUE_RESUBMIT_AFTER_MS",
	15 * 60_000
);
const STUCK_QUEUE_FAIL_AFTER_MS = readEnvMs(
	"GENERATOR_STUCK_QUEUE_FAIL_AFTER_MS",
	30 * 60_000
);
// Live-апдейты приходят через SSE-стрим (см. subscribeToExecutionStream).
// Polling здесь — safety net на случай разрыва стрима, поэтому интервалы
// растянуты: для running ждём 30с, для queued — 20-60с в зависимости от
// возраста. Реальный финальный update обычно прилетает раньше — через
// `terminal` event стрима, который сам триггерит sync с delayMs:0.
const DEFAULT_RUNNING_SYNC_DELAY_MS = 12_000;
const DEFAULT_QUEUED_SYNC_DELAY_MS = 12_000;
const MEDIUM_QUEUED_SYNC_DELAY_MS = 24_000;
const LONG_QUEUED_SYNC_DELAY_MS = 45_000;

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

function extractSucceededArtifactUrls(
	workflow: NonNullable<ReturnType<typeof getWorkflowDefinition>>,
	job: InferenceJob
): string[] {
	return job.status === "succeeded"
		? workflow.extractArtifactUrls(job.output)
		: [];
}

const PROGRESS_CAP_PCT = 90;
const RUNNING_PROGRESS_FLOOR_PCT = 8;

interface DeriveProgressInput {
	createdAt: Date;
	jobSnapshot?: {
		progressPct?: number | null;
		queuePosition?: number | null;
	} | null;
	persistedProgressPct: number | null;
	providerJobId: string | null;
	status: GeneratorExecutionRecord["status"];
	updatedAt: Date;
	workflowKey: string;
}

interface DeriveProgressResult {
	etaMs: number | null;
	phase: ExecutionPhase;
	progressPct: number;
}

/**
 * Sole source of truth для (phase, progressPct, etaMs):
 * - terminal статусы → 100% / done|failed.
 * - queued/submitting/in_queue → 0%, без persisted/provider/soft-progress.
 * - реальный progress от провайдера задаёт нижнюю границу.
 * - soft-progress по 1 - exp(-elapsed / expected) пока running.
 * - монотонность через max(persisted, computed).
 *
 * `etaMs` выводится из expected duration минус elapsed (для running) или
 * полная expected (для queued).
 */
export function derivePhaseAndProgress(
	input: DeriveProgressInput
): DeriveProgressResult {
	if (input.status === "succeeded") {
		return { etaMs: 0, phase: "done", progressPct: 100 };
	}
	if (input.status === "failed") {
		return { etaMs: 0, phase: "failed", progressPct: 100 };
	}

	const phase = derivePhase(input);
	const expectedMs = getWorkflowExpectedDurationMs(input.workflowKey);

	if (input.status === "queued") {
		return {
			etaMs: expectedMs ?? null,
			phase,
			progressPct: 0,
		};
	}

	const elapsedMs = Date.now() - input.updatedAt.getTime();

	const realProgress =
		typeof input.jobSnapshot?.progressPct === "number"
			? clampProgressPct(input.jobSnapshot.progressPct)
			: null;

	const softProgress =
		expectedMs && input.status === "running"
			? Math.round((1 - Math.exp(-elapsedMs / expectedMs)) * PROGRESS_CAP_PCT)
			: null;

	const persisted = input.persistedProgressPct ?? 0;

	const computed = Math.max(
		RUNNING_PROGRESS_FLOOR_PCT,
		realProgress ?? 0,
		softProgress ?? 0,
		persisted
	);
	const progressPct = Math.min(PROGRESS_CAP_PCT, computed);

	let etaMs: number | null = null;
	if (expectedMs) {
		etaMs = Math.max(0, expectedMs - elapsedMs);
	}

	return { etaMs, phase, progressPct };
}

function clampProgressPct(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	if (value < 0) {
		return 0;
	}
	if (value > 100) {
		return 100;
	}
	return Math.round(value);
}

function derivePhase(input: {
	jobSnapshot?: { queuePosition?: number | null } | null;
	providerJobId: string | null;
	status: GeneratorExecutionRecord["status"];
}): ExecutionPhase {
	if (input.status === "queued") {
		if (!input.providerJobId) {
			return "submitting";
		}
		const position = input.jobSnapshot?.queuePosition;
		if (typeof position === "number" && position > 0) {
			return "in_queue";
		}
		return "queued";
	}
	if (input.status === "running") {
		return "running";
	}
	return "queued";
}

export interface ExecutionEntity {
	artifacts: Array<{ url: string | null }>;
	callback: {
		context?: Record<string, unknown>;
		token?: string;
		url?: string;
	} | null;
	createdAt: Date;
	errorSummary: string | null;
	id: string;
	inputImageUrl: string | null;
	lastLogLine: string | null;
	params: Record<string, unknown>;
	progressPct: number | null;
	prompt: string;
	providerEndpointId: string | null;
	providerJobId: string | null;
	queuePosition: number | null;
	status: GeneratorExecutionRecord["status"];
	updatedAt: Date;
	workflowKey: string;
}

export interface ExecutionRepository {
	createExecution(
		input: Omit<ExecutionEntity, "createdAt" | "updatedAt">
	): Promise<ExecutionEntity>;
	getExecutionById(executionId: string): Promise<ExecutionEntity | null>;
	/**
	 * Возвращает все queued/running executions у которых уже есть providerJobId.
	 * Нужно при старте worker'а чтобы переподписаться на SSE для активных
	 * запросов после рестарта. Опционально — может не быть реализован
	 * во всех реализациях (тесты могут вернуть пустой массив).
	 */
	listActiveExecutionsForStream?: () => Promise<ExecutionEntity[]>;
	updateExecution(
		executionId: string,
		input: Partial<Omit<ExecutionEntity, "createdAt" | "updatedAt" | "id">>
	): Promise<ExecutionEntity | null>;
}

function toExecutionRecord(entity: ExecutionEntity): GeneratorExecutionRecord {
	const derived = derivePhaseAndProgress({
		createdAt: entity.createdAt,
		jobSnapshot: {
			progressPct: entity.progressPct,
			queuePosition: entity.queuePosition,
		},
		persistedProgressPct: entity.progressPct,
		providerJobId: entity.providerJobId,
		status: entity.status,
		updatedAt: entity.updatedAt,
		workflowKey: entity.workflowKey,
	});
	return {
		artifacts: entity.artifacts,
		callback: entity.callback ?? null,
		createdAt: entity.createdAt.toISOString(),
		errorSummary: entity.errorSummary,
		etaMs: derived.etaMs,
		id: entity.id,
		inputImageUrl: entity.inputImageUrl ?? "",
		lastLogLine: entity.lastLogLine,
		params: entity.params,
		phase: derived.phase,
		progressPct: derived.progressPct,
		prompt: entity.prompt,
		providerEndpointId: entity.providerEndpointId,
		providerJobId: entity.providerJobId,
		queuePosition: entity.queuePosition,
		status: entity.status,
		updatedAt: entity.updatedAt.toISOString(),
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
	const now = new Date();
	const derived = derivePhaseAndProgress({
		createdAt: now,
		jobSnapshot: null,
		persistedProgressPct: null,
		providerJobId: input.providerJobId ?? null,
		status: input.status,
		updatedAt: now,
		workflowKey: input.workflowKey,
	});
	return {
		artifacts: (input.artifacts ?? []).map((url) => ({ url })),
		errorSummary: input.errorSummary ?? null,
		etaMs: derived.etaMs,
		id: input.providerJobId ?? crypto.randomUUID(),
		inputImageUrl: input.inputImageUrl ?? "",
		phase: derived.phase,
		providerEndpointId: input.providerEndpointId ?? null,
		providerJobId: input.providerJobId ?? null,
		progressPct: derived.progressPct,
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
	private readonly eventPublisher: EventPublisher | null;

	constructor(
		repository: ExecutionRepository,
		queue: GeneratorExecutionQueue,
		inferenceClient: InferenceClient,
		storageAdapter: StorageAdapter,
		logger: ExecutionLogger = console,
		eventPublisher: EventPublisher | null = null
	) {
		this.repository = repository;
		this.queue = queue;
		this.inferenceClient = inferenceClient;
		this.storageAdapter = storageAdapter;
		this.logger = logger;
		this.eventPublisher = eventPublisher;
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

	private async persistJobArtifacts(input: {
		executionId: string;
		rawUrls: string[];
	}): Promise<
		{ ok: true; urls: string[] } | { ok: false; errorSummary: string }
	> {
		if (input.rawUrls.length === 0) {
			return { ok: true, urls: [] };
		}
		try {
			const urls = await this.storageAdapter.persistArtifactUrls({
				executionId: input.executionId,
				urls: input.rawUrls,
			});
			return { ok: true, urls };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "unknown persistence error";
			this.logger.error("generator.execution.persist-artifacts-failed", {
				error: message,
				executionId: input.executionId,
				rawUrlCount: input.rawUrls.length,
			});
			return {
				errorSummary: `Failed to persist artifacts to S3: ${message}`,
				ok: false,
			};
		}
	}

	private async failExecutionFromNonRetryableError(
		execution: ExecutionEntity,
		error: unknown
	): Promise<boolean> {
		if (!isNonRetryableInferenceError(error)) {
			return false;
		}

		const errorSummary = error.message;
		const updated = await this.repository.updateExecution(execution.id, {
			errorSummary,
			status: "failed",
		});
		this.logger.info("generator.execution.non-retryable-failed", {
			error: errorSummary,
			executionId: execution.id,
			workflowKey: execution.workflowKey,
		});
		if (updated) {
			await this.dispatchExecutionCallback(updated);
		}
		return true;
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
			lastLogLine: null,
			params: normalizedParams,
			progressPct: null,
			providerEndpointId: null,
			providerJobId: null,
			prompt: parsed.prompt,
			queuePosition: null,
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
		const rawArtifactUrls = extractSucceededArtifactUrls(workflow, job);
		const artifacts =
			rawArtifactUrls.length === 0
				? []
				: await this.storageAdapter.persistArtifactUrls({
						executionId: parsed.providerJobId,
						urls: rawArtifactUrls,
					});

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

		if (this.eventPublisher) {
			try {
				await this.eventPublisher.publishGeneratorExecutionUpdated({
					context: execution.callback.context ?? {},
					execution: toExecutionRecord(execution),
				});
			} catch (error) {
				this.logger.error("generator.event-publish.error", {
					error: error instanceof Error ? error.message : "unknown error",
					executionId: execution.id,
				});
			}
		}

		if (!execution.callback.url) {
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

	/**
	 * Live SSE-подписка на job-стрим провайдера. Открывается в фоне после
	 * processExecutionSubmitJob. Каждое event'а:
	 *  - не-terminal (queued/running) → light update progress полей в БД
	 *    + dispatch callback. Не дёргаем `getStatus` — у нас уже есть свежий
	 *    snapshot из стрима.
	 *  - terminal (succeeded/failed) → enqueue `sync` job без задержки. Sync
	 *    добёрет финальный output (`GET /requests/{id}`), персистит артефакты
	 *    через стандартный путь.
	 *
	 * Это убирает 2-3-секундный polling lag для queue_position-апдейтов и
	 * мгновенно сообщает о завершении (вместо ожидания следующего sync-job'а).
	 *
	 * Polling остаётся как safety net — если SSE упадёт по сети, sync-job
	 * (с увеличенным интервалом) рано или поздно подтянет состояние.
	 */
	subscribeToExecutionStream(input: {
		executionId: string;
		providerEndpointId: string;
		providerJobId: string;
	}): InferenceStreamHandle | null {
		if (!this.inferenceClient.streamStatus) {
			return null;
		}

		const handle = this.inferenceClient.streamStatus({
			endpointId: input.providerEndpointId,
			jobId: input.providerJobId,
			onEvent: async (event) => {
				try {
					await this.handleStreamEvent(input.executionId, event.job);
					if (event.terminal) {
						await this.queue.enqueueSync({
							delayMs: 0,
							executionId: input.executionId,
						});
					}
				} catch (error) {
					this.logger.error("generator.execution.stream-event.error", {
						error: error instanceof Error ? error.message : "unknown",
						executionId: input.executionId,
						providerJobId: input.providerJobId,
					});
				}
			},
		});

		handle.done.catch((error) => {
			this.logger.error("generator.execution.stream.error", {
				error: error instanceof Error ? error.message : "unknown",
				executionId: input.executionId,
				providerJobId: input.providerJobId,
			});
		});

		this.logger.info("generator.execution.stream.subscribed", {
			executionId: input.executionId,
			providerEndpointId: input.providerEndpointId,
			providerJobId: input.providerJobId,
		});

		return handle;
	}

	/**
	 * Применяет live-снимок из SSE к текущему execution. Только light-update
	 * прогресс/queue/log полей — для terminal-events запускается отдельный
	 * sync-job, который добёрет output.
	 */
	private async handleStreamEvent(executionId: string, job: InferenceJob) {
		const execution = await this.repository.getExecutionById(executionId);
		if (
			!execution ||
			execution.status === "succeeded" ||
			execution.status === "failed"
		) {
			return;
		}

		const progressUpdate = this.composeProgressUpdate(execution, job);
		const statusChanged =
			job.status !== "succeeded" &&
			job.status !== "failed" &&
			execution.status !== job.status;
		if (!(progressUpdate.changed || statusChanged)) {
			return;
		}

		const updated = await this.repository.updateExecution(execution.id, {
			...progressUpdate.patch,
			...(statusChanged ? { status: job.status } : {}),
		});
		if (updated) {
			await this.dispatchExecutionCallback(updated);
		}
	}

	/**
	 * Восстанавливает SSE-подписки на старте процесса для всех executions, у
	 * которых уже есть providerJobId и статус queued/running. Без этого после
	 * рестарта worker'а live-апдейты не приходили бы до следующего polling.
	 */
	async resumeActiveExecutionStreams(): Promise<number> {
		if (!this.repository.listActiveExecutionsForStream) {
			return 0;
		}
		if (!this.inferenceClient.streamStatus) {
			return 0;
		}

		const active = await this.repository.listActiveExecutionsForStream();
		let started = 0;
		for (const execution of active) {
			if (!(execution.providerJobId && execution.providerEndpointId)) {
				continue;
			}
			this.subscribeToExecutionStream({
				executionId: execution.id,
				providerEndpointId: execution.providerEndpointId,
				providerJobId: execution.providerJobId,
			});
			started += 1;
		}
		return started;
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

		let submission: InferenceSubmission;
		try {
			submission = await this.inferenceClient.submit(
				this.buildSubmissionPayload(execution, workflow),
				{ stickyKey: execution.id }
			);
		} catch (error) {
			if (await this.failExecutionFromNonRetryableError(execution, error)) {
				return;
			}
			throw error;
		}

		if (submission.status === "succeeded" || submission.status === "failed") {
			const job = await this.inferenceClient.getStatus(
				submission.jobId,
				submission.endpointId
			);
			const persistedArtifacts = await this.persistJobArtifacts({
				executionId: execution.id,
				rawUrls: extractSucceededArtifactUrls(workflow, job),
			});
			if (!persistedArtifacts.ok) {
				const failed = await this.repository.updateExecution(execution.id, {
					artifacts: [],
					errorSummary: persistedArtifacts.errorSummary,
					providerEndpointId: submission.endpointId,
					providerJobId: submission.jobId,
					status: "failed",
				});
				if (failed) {
					await this.dispatchExecutionCallback(failed);
				}
				return;
			}
			const finalExecution = await this.repository.updateExecution(
				execution.id,
				{
					artifacts: persistedArtifacts.urls.map((url) => ({ url })),
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
				queuePosition:
					typeof submission.queuePosition === "number"
						? submission.queuePosition
						: null,
				status: submission.status,
			}
		);
		if (!updatedExecution) {
			return;
		}
		await this.dispatchExecutionCallback(updatedExecution);

		// Поднимаем live SSE-стрим — live-апдейты приходят моментально, без
		// 2-3 секундного polling lag'а.
		this.subscribeToExecutionStream({
			executionId: execution.id,
			providerEndpointId: submission.endpointId,
			providerJobId: submission.jobId,
		});

		// Polling остаётся как safety net на случай разрыва стрима. Интервал
		// здесь сознательно растянут — стрим должен покрывать «горячий путь».
		await this.queue.enqueueSync({
			delayMs: getNextSyncDelay(submission.status, 0),
			executionId: execution.id,
		});
	}

	/**
	 * Считает обновление progress-полей с учётом монотонности (прогресс не
	 * откатывается). Возвращает только diff — `null`-ы означают «оставь как
	 * было», поэтому undefined-полей в `set` не появится.
	 */
	private composeProgressUpdate(
		execution: ExecutionEntity,
		job: InferenceJob
	): {
		changed: boolean;
		patch: {
			lastLogLine?: string | null;
			progressPct?: number | null;
			queuePosition?: number | null;
		};
	} {
		const patch: {
			lastLogLine?: string | null;
			progressPct?: number | null;
			queuePosition?: number | null;
		} = {};
		let changed = false;

		const incomingProgress =
			job.status !== "queued" && typeof job.progressPct === "number"
				? clampProgressPct(job.progressPct)
				: null;
		if (incomingProgress !== null) {
			const next = Math.max(execution.progressPct ?? 0, incomingProgress);
			if (next !== execution.progressPct) {
				patch.progressPct = next;
				changed = true;
			}
		}

		const incomingQueue =
			typeof job.queuePosition === "number" ? job.queuePosition : null;
		if (incomingQueue !== execution.queuePosition) {
			patch.queuePosition = incomingQueue;
			changed = true;
		}

		const incomingLog = job.lastLogLine ?? null;
		if (incomingLog && incomingLog !== execution.lastLogLine) {
			patch.lastLogLine = incomingLog;
			changed = true;
		}

		return { changed, patch };
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
		const persisted = await this.persistJobArtifacts({
			executionId: execution.id,
			rawUrls: extractSucceededArtifactUrls(workflow, job),
		});
		if (!persisted.ok) {
			const failed = await this.repository.updateExecution(execution.id, {
				artifacts: [],
				errorSummary: persisted.errorSummary,
				status: "failed",
			});
			if (failed) {
				await this.dispatchExecutionCallback(failed);
			}
			return;
		}
		const nextArtifacts = persisted.urls.map((url) => ({ url }));
		const artifactsChanged =
			execution.artifacts.length !== nextArtifacts.length ||
			execution.artifacts.some((a, i) => a.url !== nextArtifacts[i]?.url);
		const progressUpdate = this.composeProgressUpdate(execution, job);
		const shouldDispatchCallback =
			execution.status !== job.status ||
			execution.providerJobId !== job.jobId ||
			execution.providerEndpointId !== job.endpointId ||
			execution.errorSummary !== job.errorSummary ||
			artifactsChanged ||
			progressUpdate.changed;

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
			let resubmission: InferenceSubmission;
			try {
				resubmission = await this.inferenceClient.submit(
					this.buildSubmissionPayload(execution, workflow),
					{ stickyKey: execution.id }
				);
			} catch (error) {
				if (await this.failExecutionFromNonRetryableError(execution, error)) {
					return;
				}
				throw error;
			}
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
			this.subscribeToExecutionStream({
				executionId: execution.id,
				providerEndpointId: resubmission.endpointId,
				providerJobId: resubmission.jobId,
			});
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
					...progressUpdate.patch,
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
