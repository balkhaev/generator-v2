import type {
	CreateGeneratorExecutionInput,
	GeneratorExecutionRecord,
	ScenarioParamValue,
	SyncGeneratorExecutionInput,
} from "@generator/contracts/generator";
import type { PersonRecord } from "@generator/contracts/persons";
import type {
	StudioRunDebugBundle,
	StudioRunRecord,
	StudioScenarioRecord,
	StudioShotArtifactKind,
	StudioShotRecord,
} from "@generator/contracts/studio";
import { normalizeBaseUrl } from "@generator/http/shared";
import { getWorkflowDefinition } from "@generator/workflows";
import { z } from "zod";

import { BadRequestError, NotFoundError } from "@/routes/utils";

const studioScenarioParamsSchema = z
	.record(z.string(), z.unknown())
	.default({});

export const createStudioScenarioInputSchema = z.object({
	name: z.string().trim().min(1, "Scenario name is required"),
	params: studioScenarioParamsSchema,
	prompt: z.string().trim().min(1, "Prompt is required"),
	workflowKey: z.string().trim().min(1, "Workflow key is required"),
});

export const updateStudioScenarioInputSchema = createStudioScenarioInputSchema
	.partial()
	.refine(
		(value) => Object.keys(value).length > 0,
		"At least one field must be provided"
	);

export const createStudioRunInputSchema = z.object({
	inputImageUrl: z.url("Input image URL must be a valid URL").optional(),
	inputPersonGenerationId: z.string().trim().min(1).optional().nullable(),
	inputPersonId: z.string().trim().min(1).optional().nullable(),
	loraPersonId: z.string().trim().min(1).optional().nullable(),
	scenarioId: z.string().trim().min(1, "Scenario id is required"),
});

export const createStudioShotInputSchema = z.object({
	artifactKind: z.enum(["image", "video", "audio"]).optional(),
	artifactUrl: z.url("Shot artifact URL must be a valid URL"),
	note: z.string().trim().max(2000).optional().nullable(),
	personGenerationId: z.string().trim().min(1).optional().nullable(),
	personId: z.string().trim().min(1).optional().nullable(),
	runId: z.string().trim().min(1, "Run id is required"),
});

export type StudioRunStatus = "queued" | "running" | "succeeded" | "failed";

const STATUS_ORDER: Record<StudioRunStatus, number> = {
	queued: 0,
	running: 1,
	succeeded: 2,
	failed: 2,
};

function isStatusProgression(
	currentStatus: StudioRunStatus,
	nextStatus: StudioRunStatus
) {
	return STATUS_ORDER[nextStatus] >= STATUS_ORDER[currentStatus];
}

export interface StudioScenarioEntity {
	createdAt: Date;
	generatorScenarioId: string | null;
	id: string;
	name: string;
	params: Record<string, unknown>;
	prompt: string;
	updatedAt: Date;
	workflowKey: string;
}

export interface StudioArtifactEntity {
	createdAt: Date;
	id: string;
	kind: string;
	metadata: Record<string, unknown>;
	runId: string;
	url: string;
}

export interface StudioRunEntity {
	artifacts: StudioArtifactEntity[];
	completedAt: Date | null;
	createdAt: Date;
	errorSummary: string | null;
	generatorRunId: string | null;
	id: string;
	inputImageUrl: string;
	inputPersonGenerationId: string | null;
	inputPersonId: string | null;
	loraPersonId: string | null;
	progressPct: number | null;
	providerEndpointId: string | null;
	providerJobId: string | null;
	scenarioId: string;
	status: StudioRunStatus;
	updatedAt: Date;
	workflowKey: string;
}

export interface StudioShotEntity {
	artifactKind: StudioShotArtifactKind;
	artifactUrl: string;
	createdAt: Date;
	id: string;
	note: string | null;
	personGenerationId: string | null;
	personId: string | null;
	runId: string;
	scenarioId: string;
}

export interface StudioRepository {
	createRun(
		input: Omit<
			StudioRunEntity,
			"artifacts" | "completedAt" | "createdAt" | "updatedAt"
		>
	): Promise<StudioRunEntity>;
	createScenario(
		input: Omit<StudioScenarioEntity, "createdAt" | "updatedAt">
	): Promise<StudioScenarioEntity>;
	createShot(
		input: Omit<StudioShotEntity, "createdAt">
	): Promise<StudioShotEntity>;
	deleteScenario(scenarioId: string): Promise<boolean>;
	deleteShot(shotId: string): Promise<boolean>;
	getRunByGeneratorRunId(
		generatorRunId: string
	): Promise<StudioRunEntity | null>;
	getRunById(runId: string): Promise<StudioRunEntity | null>;
	getScenarioByGeneratorScenarioId(
		generatorScenarioId: string
	): Promise<StudioScenarioEntity | null>;
	getScenarioById(scenarioId: string): Promise<StudioScenarioEntity | null>;
	listActiveRuns(limit: number): Promise<StudioRunEntity[]>;
	listRuns(): Promise<StudioRunEntity[]>;
	listScenarios(): Promise<StudioScenarioEntity[]>;
	listShots(): Promise<StudioShotEntity[]>;
	replaceArtifacts(
		runId: string,
		artifacts: Omit<StudioArtifactEntity, "createdAt">[]
	): Promise<StudioArtifactEntity[]>;
	updateRun(
		runId: string,
		input: Partial<
			Pick<
				StudioRunEntity,
				| "completedAt"
				| "errorSummary"
				| "generatorRunId"
				| "inputImageUrl"
				| "inputPersonGenerationId"
				| "inputPersonId"
				| "loraPersonId"
				| "progressPct"
				| "providerEndpointId"
				| "providerJobId"
				| "status"
			>
		>
	): Promise<StudioRunEntity | null>;
	updateScenario(
		scenarioId: string,
		input: Partial<
			Pick<
				StudioScenarioEntity,
				"generatorScenarioId" | "name" | "params" | "prompt" | "workflowKey"
			>
		>
	): Promise<StudioScenarioEntity | null>;
}

export interface StudioExecutionClient {
	createExecution(
		input: CreateGeneratorExecutionInput,
		options?: {
			debugCorrelationId?: string;
		}
	): Promise<GeneratorExecutionRecord>;
	getExecution(
		executionId: string,
		options?: {
			debugCorrelationId?: string;
		}
	): Promise<GeneratorExecutionRecord>;
	syncExecution(
		input: SyncGeneratorExecutionInput,
		options?: {
			debugCorrelationId?: string;
		}
	): Promise<GeneratorExecutionRecord>;
}

type StudioLogger = Pick<Console, "info" | "error">;

type HttpFetch = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

function toScenarioParamValue(value: unknown): ScenarioParamValue {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}

	return JSON.stringify(value);
}

function toStudioScenarioRecord(
	entity: StudioScenarioEntity
): StudioScenarioRecord {
	return {
		createdAt: entity.createdAt.toISOString(),
		generatorScenarioId: entity.generatorScenarioId,
		id: entity.id,
		name: entity.name,
		params: Object.fromEntries(
			Object.entries(entity.params).map(([key, value]) => [
				key,
				toScenarioParamValue(value),
			])
		),
		prompt: entity.prompt,
		updatedAt: entity.updatedAt.toISOString(),
		workflowKey: entity.workflowKey,
	};
}

function executionProgressPct(
	execution: Pick<GeneratorExecutionRecord, "progressPct">
): number | null {
	const raw = execution.progressPct;
	if (raw == null || !Number.isFinite(raw)) {
		return null;
	}
	return Math.max(0, Math.min(100, Math.round(Number(raw))));
}

function toStudioRunRecord(entity: StudioRunEntity): StudioRunRecord {
	return {
		artifacts: entity.artifacts.map((artifact) => ({
			kind: artifact.kind,
			url: artifact.url,
		})),
		createdAt: entity.createdAt.toISOString(),
		errorSummary: entity.errorSummary,
		generatorRunId: entity.generatorRunId,
		id: entity.id,
		inputImageUrl: entity.inputImageUrl,
		inputPersonGenerationId: entity.inputPersonGenerationId,
		inputPersonId: entity.inputPersonId,
		loraPersonId: entity.loraPersonId ?? null,
		progressPct: entity.progressPct,
		providerEndpointId: entity.providerEndpointId,
		providerJobId: entity.providerJobId,
		scenarioId: entity.scenarioId,
		status: entity.status,
		workflowKey: entity.workflowKey,
	};
}

function toStudioShotRecord(entity: StudioShotEntity): StudioShotRecord {
	return {
		artifactKind: entity.artifactKind,
		artifactUrl: entity.artifactUrl,
		createdAt: entity.createdAt.toISOString(),
		id: entity.id,
		note: entity.note,
		personGenerationId: entity.personGenerationId,
		personId: entity.personId,
		runId: entity.runId,
		scenarioId: entity.scenarioId,
	};
}

function mapExecutionToArtifacts(
	runId: string,
	execution: GeneratorExecutionRecord
) {
	return execution.artifacts
		.filter((artifact): artifact is { url: string } => Boolean(artifact.url))
		.map((artifact) => ({
			id: crypto.randomUUID(),
			kind: "output",
			metadata: {},
			runId,
			url: artifact.url,
		}));
}

function workflowAcceptsOptionalLora(workflowKey: string) {
	const definition = getWorkflowDefinition(workflowKey);
	return Boolean(
		definition?.parameterFields.some((field) => field.key === "loraUrl")
	);
}

async function resolvePersonLoraUrl(params: {
	cookieHeader: string;
	fetchImpl: HttpFetch;
	personId: string;
	personsApiBaseUrl: string;
}): Promise<string | null> {
	const base = normalizeBaseUrl(params.personsApiBaseUrl);
	const response = await params.fetchImpl(
		`${base}/api/persons/${params.personId}`,
		{
			headers: {
				accept: "application/json",
				...(params.cookieHeader ? { cookie: params.cookieHeader } : {}),
			},
		}
	);
	if (!response.ok) {
		const fragment = (await response.text()).slice(0, 220);
		throw new BadRequestError(
			`Could not load Cast person (${response.status}): ${fragment}`
		);
	}
	const payload = (await response.json()) as { person: PersonRecord };
	const url = payload.person.loraUrl?.trim();
	return url && url.length > 0 ? url : null;
}

export class StudioService {
	private readonly callbackConfig?: { token: string; url?: string };
	private readonly executionClient: StudioExecutionClient;
	private readonly logger: StudioLogger;
	private readonly outboundFetch: HttpFetch;
	private readonly personsApiBaseUrl?: string;
	private readonly repository: StudioRepository;

	constructor(
		repository: StudioRepository,
		executionClient: StudioExecutionClient,
		logger: StudioLogger = console,
		callbackConfig?: { token: string; url?: string },
		resolver?: {
			fetchImpl?: HttpFetch;
			personsApiBaseUrl?: string;
		}
	) {
		this.repository = repository;
		this.executionClient = executionClient;
		this.logger = logger;
		this.callbackConfig = callbackConfig;
		this.personsApiBaseUrl = resolver?.personsApiBaseUrl?.trim();
		this.outboundFetch = resolver?.fetchImpl ?? fetch;
	}

	private resolveLatestExecution(
		run: Pick<
			StudioRunEntity,
			"generatorRunId" | "providerEndpointId" | "providerJobId" | "workflowKey"
		>,
		options?: {
			debugCorrelationId?: string;
		}
	): ReturnType<StudioExecutionClient["getExecution"]> {
		if (run.providerJobId) {
			return this.executionClient.syncExecution(
				{
					providerEndpointId: run.providerEndpointId ?? undefined,
					providerJobId: run.providerJobId,
					workflowKey: run.workflowKey,
				},
				options
			);
		}

		if (!run.generatorRunId) {
			throw new Error("Studio run has no generator execution id.");
		}

		return this.executionClient.getExecution(run.generatorRunId, options);
	}

	async listScenarios() {
		return (await this.repository.listScenarios()).map(toStudioScenarioRecord);
	}

	async createScenario(input: z.input<typeof createStudioScenarioInputSchema>) {
		const parsed = createStudioScenarioInputSchema.parse(input);
		const created = await this.repository.createScenario({
			generatorScenarioId: null,
			id: crypto.randomUUID(),
			name: parsed.name,
			params: parsed.params,
			prompt: parsed.prompt,
			workflowKey: parsed.workflowKey,
		});
		return toStudioScenarioRecord(created);
	}

	async updateScenario(
		scenarioId: string,
		input: z.input<typeof updateStudioScenarioInputSchema>
	) {
		const parsed = updateStudioScenarioInputSchema.parse(input);
		const current = await this.repository.getScenarioById(scenarioId);
		if (!current) {
			return null;
		}

		const updated = await this.repository.updateScenario(scenarioId, {
			name: parsed.name ?? current.name,
			params: parsed.params ?? current.params,
			prompt: parsed.prompt ?? current.prompt,
			workflowKey: parsed.workflowKey ?? current.workflowKey,
		});

		return updated ? toStudioScenarioRecord(updated) : null;
	}

	async getScenarioById(scenarioId: string) {
		const scenario = await this.repository.getScenarioById(scenarioId);
		return scenario ? toStudioScenarioRecord(scenario) : null;
	}

	deleteScenario(scenarioId: string) {
		return this.repository.deleteScenario(scenarioId);
	}

	async listRuns() {
		return (await this.repository.listRuns()).map(toStudioRunRecord);
	}

	async getRunById(runId: string) {
		const run = await this.repository.getRunById(runId);
		return run ? toStudioRunRecord(run) : null;
	}

	async getRunDebugBundle(
		runId: string,
		options?: { debugCorrelationId?: string }
	): Promise<StudioRunDebugBundle | null> {
		const entity = await this.repository.getRunById(runId);
		if (!entity) {
			return null;
		}
		const run = toStudioRunRecord(entity);
		if (!entity.generatorRunId) {
			return { execution: null, executionError: null, run };
		}
		try {
			const execution = await this.executionClient.getExecution(
				entity.generatorRunId,
				{ debugCorrelationId: options?.debugCorrelationId }
			);
			return { execution, executionError: null, run };
		} catch (error) {
			const executionError =
				error instanceof Error ? error.message : "Unknown error";
			return { execution: null, executionError, run };
		}
	}

	private async buildMergedExecutionParams(
		scenario: StudioScenarioEntity,
		parsed: z.infer<typeof createStudioRunInputSchema>,
		cookieHeader: string
	): Promise<Record<string, unknown>> {
		const mergedExecutionParams: Record<string, unknown> = {
			...(scenario.params as Record<string, unknown>),
		};
		if (!parsed.loraPersonId) {
			return mergedExecutionParams;
		}
		if (!workflowAcceptsOptionalLora(scenario.workflowKey)) {
			throw new BadRequestError(
				"This scenario does not support applying a Cast person LoRA."
			);
		}
		if (!this.personsApiBaseUrl) {
			throw new BadRequestError(
				"PERSONS_API_URL is not configured on studio-api; cannot resolve Cast LoRA."
			);
		}
		const loraUrl = await resolvePersonLoraUrl({
			cookieHeader,
			fetchImpl: this.outboundFetch,
			personId: parsed.loraPersonId,
			personsApiBaseUrl: this.personsApiBaseUrl,
		});
		if (!loraUrl) {
			throw new BadRequestError(
				"Selected Cast person has no trained LoRA yet."
			);
		}
		mergedExecutionParams.loraUrl = loraUrl;
		return mergedExecutionParams;
	}

	async launchRun(
		input: z.input<typeof createStudioRunInputSchema>,
		options?: {
			cookieHeader?: string;
			debugCorrelationId?: string;
		}
	) {
		const parsed = createStudioRunInputSchema.parse(input);
		const scenario = await this.repository.getScenarioById(parsed.scenarioId);
		if (!scenario) {
			throw new NotFoundError(`Scenario not found: ${parsed.scenarioId}`);
		}
		const workflow = getWorkflowDefinition(scenario.workflowKey);
		if (workflow?.requiresInputImage && !parsed.inputImageUrl) {
			throw new BadRequestError(
				`Workflow ${scenario.workflowKey} requires an input image URL`
			);
		}

		const mergedExecutionParams = await this.buildMergedExecutionParams(
			scenario,
			parsed,
			options?.cookieHeader ?? ""
		);

		const createdRun = await this.repository.createRun({
			errorSummary: null,
			generatorRunId: null,
			id: crypto.randomUUID(),
			inputImageUrl: parsed.inputImageUrl ?? "",
			inputPersonGenerationId: parsed.inputPersonGenerationId ?? null,
			inputPersonId: parsed.inputPersonId ?? null,
			loraPersonId: parsed.loraPersonId ?? null,
			progressPct: null,
			providerEndpointId: null,
			providerJobId: null,
			scenarioId: scenario.id,
			status: "queued",
			workflowKey: scenario.workflowKey,
		});

		let execution: GeneratorExecutionRecord;
		try {
			execution = await this.executionClient.createExecution(
				{
					callback: this.callbackConfig
						? {
								context: {
									runId: createdRun.id,
								},
								token: this.callbackConfig.token,
								...(this.callbackConfig.url
									? { url: this.callbackConfig.url }
									: {}),
							}
						: undefined,
					...(parsed.inputImageUrl
						? { inputImageUrl: parsed.inputImageUrl }
						: {}),
					params: mergedExecutionParams,
					prompt: scenario.prompt,
					workflowKey: scenario.workflowKey,
				},
				{ debugCorrelationId: options?.debugCorrelationId }
			);
		} catch (error) {
			// Не оставляем «зомби»-row в queued при провале старта в generator-api:
			// иначе фронт будет бесконечно дёргать /sync и получать 500 (нет
			// generatorRunId). Помечаем сразу как failed, чтобы UI показал ошибку.
			const errorSummary =
				error instanceof Error
					? error.message
					: "Failed to launch generator execution";
			await this.repository
				.updateRun(createdRun.id, {
					completedAt: new Date(),
					errorSummary,
					progressPct: null,
					status: "failed",
				})
				.catch((markError) => {
					this.logger.error("studio.execution.create.mark-failed-failed", {
						markError:
							markError instanceof Error ? markError.message : "unknown",
						runId: createdRun.id,
					});
				});
			this.logger.error("studio.execution.create.failed", {
				debugCorrelationId: options?.debugCorrelationId ?? null,
				errorSummary,
				runId: createdRun.id,
				scenarioId: scenario.id,
			});
			throw error;
		}

		this.logger.info("studio.execution.create", {
			debugCorrelationId: options?.debugCorrelationId ?? null,
			executionId: execution.id,
			runId: createdRun.id,
			scenarioId: scenario.id,
		});

		await this.repository.replaceArtifacts(
			createdRun.id,
			mapExecutionToArtifacts(createdRun.id, execution)
		);

		const updated = await this.repository.updateRun(createdRun.id, {
			errorSummary: execution.errorSummary ?? null,
			generatorRunId: execution.id,
			inputImageUrl: execution.inputImageUrl,
			progressPct: executionProgressPct(execution),
			providerEndpointId: execution.providerEndpointId,
			providerJobId: execution.providerJobId,
			status: execution.status,
		});

		if (!updated) {
			throw new Error("Failed to persist studio run after generator launch.");
		}

		return toStudioRunRecord(updated);
	}

	async syncRun(
		runId: string,
		options?: {
			debugCorrelationId?: string;
		}
	) {
		const currentRun = await this.repository.getRunById(runId);
		if (!currentRun) {
			return null;
		}
		if (!currentRun.generatorRunId) {
			throw new Error(`Studio run ${runId} has no generator execution id.`);
		}

		const execution = await this.resolveLatestExecution(currentRun, options);

		if (!isStatusProgression(currentRun.status, execution.status)) {
			return toStudioRunRecord(currentRun);
		}

		this.logger.info("studio.execution.sync", {
			debugCorrelationId: options?.debugCorrelationId ?? null,
			executionId: execution.id,
			runId,
			status: execution.status,
		});

		const completedAt =
			execution.status === "succeeded" || execution.status === "failed"
				? new Date()
				: null;

		await this.repository.replaceArtifacts(
			runId,
			mapExecutionToArtifacts(runId, execution)
		);

		const updatedRun = await this.repository.updateRun(runId, {
			completedAt,
			errorSummary: execution.errorSummary ?? null,
			generatorRunId: execution.id,
			inputImageUrl: currentRun.inputImageUrl,
			progressPct: executionProgressPct(execution),
			providerEndpointId: execution.providerEndpointId,
			providerJobId: execution.providerJobId,
			status: execution.status,
		});

		return updatedRun ? toStudioRunRecord(updatedRun) : null;
	}

	/**
	 * Точечно перевести run в `failed` со связанным `errorSummary`.
	 * Нужен для ручной зачистки orphan-ров (например, через MCP-tool
	 * `studio_run_mark_failed`), когда `launchRun` не успел сам пометить запись
	 * — например, после рестарта studio-api между попытками.
	 */
	async markRunFailed(runId: string, errorSummary: string) {
		const currentRun = await this.repository.getRunById(runId);
		if (!currentRun) {
			return null;
		}
		const updated = await this.repository.updateRun(runId, {
			completedAt: new Date(),
			errorSummary,
			progressPct: null,
			status: "failed",
		});
		this.logger.info("studio.run.mark-failed", {
			errorSummary,
			previousStatus: currentRun.status,
			runId,
		});
		return updated ? toStudioRunRecord(updated) : null;
	}

	async applyExecutionCallback(input: {
		context: Record<string, unknown>;
		execution: GeneratorExecutionRecord;
	}) {
		const runId =
			typeof input.context.runId === "string" ? input.context.runId : null;
		if (!runId) {
			throw new Error("Invalid studio execution callback context");
		}

		const currentRun = await this.repository.getRunById(runId);
		if (!currentRun) {
			return null;
		}

		if (
			!isStatusProgression(
				currentRun.status,
				input.execution.status as StudioRunStatus
			)
		) {
			return toStudioRunRecord(currentRun);
		}

		const completedAt =
			input.execution.status === "succeeded" ||
			input.execution.status === "failed"
				? new Date()
				: null;

		await this.repository.replaceArtifacts(
			runId,
			mapExecutionToArtifacts(runId, input.execution)
		);

		const updatedRun = await this.repository.updateRun(runId, {
			completedAt,
			errorSummary: input.execution.errorSummary ?? null,
			generatorRunId: input.execution.id,
			progressPct: executionProgressPct(input.execution),
			providerEndpointId: input.execution.providerEndpointId,
			providerJobId: input.execution.providerJobId,
			status: input.execution.status,
		});

		return updatedRun ? toStudioRunRecord(updatedRun) : null;
	}

	async listShots() {
		return (await this.repository.listShots()).map(toStudioShotRecord);
	}

	async createShot(input: z.input<typeof createStudioShotInputSchema>) {
		const parsed = createStudioShotInputSchema.parse(input);
		const run = await this.repository.getRunById(parsed.runId);
		if (!run) {
			throw new NotFoundError(`Run not found: ${parsed.runId}`);
		}

		const created = await this.repository.createShot({
			artifactKind: parsed.artifactKind ?? "image",
			artifactUrl: parsed.artifactUrl,
			id: crypto.randomUUID(),
			note: parsed.note ?? null,
			personGenerationId: parsed.personGenerationId ?? null,
			personId: parsed.personId ?? run.inputPersonId ?? null,
			runId: run.id,
			scenarioId: run.scenarioId,
		});

		return toStudioShotRecord(created);
	}

	deleteShot(shotId: string) {
		return this.repository.deleteShot(shotId);
	}

	async reconcileActiveRuns(limit = 10) {
		let updatedCount = 0;
		const runs = await this.repository.listActiveRuns(limit);
		for (const run of runs) {
			if (!(run.generatorRunId || run.providerJobId)) {
				continue;
			}
			try {
				const execution = await this.resolveLatestExecution(run);
				if (
					!isStatusProgression(run.status, execution.status as StudioRunStatus)
				) {
					continue;
				}
				const completedAt =
					execution.status === "succeeded" || execution.status === "failed"
						? new Date()
						: null;
				await this.repository.replaceArtifacts(
					run.id,
					mapExecutionToArtifacts(run.id, execution)
				);
				const updated = await this.repository.updateRun(run.id, {
					completedAt,
					errorSummary: execution.errorSummary ?? null,
					generatorRunId: execution.id,
					progressPct: executionProgressPct(execution),
					providerEndpointId: execution.providerEndpointId,
					providerJobId: execution.providerJobId,
					status: execution.status,
				});
				if (updated) {
					updatedCount += 1;
				}
				this.logger.info("studio.reconcile.run-synced", {
					runId: run.id,
					status: execution.status,
				});
			} catch (error) {
				this.logger.error("studio.reconcile.run-failed", {
					message: error instanceof Error ? error.message : "unknown",
					runId: run.id,
				});
			}
		}
		return { updatedCount };
	}
}
