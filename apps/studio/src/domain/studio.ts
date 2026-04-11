import type {
	CreateGeneratorExecutionInput,
	GeneratorExecutionRecord,
	ScenarioParamValue,
	SyncGeneratorExecutionInput,
} from "@generator/contracts/generator";
import type {
	StudioRunRecord,
	StudioScenarioRecord,
} from "@generator/contracts/studio";
import { z } from "zod";

import { NotFoundError } from "@/routes/utils";

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
	inputImageUrl: z.url("Input image URL must be a valid URL"),
	scenarioId: z.string().trim().min(1, "Scenario id is required"),
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
	providerEndpointId: string | null;
	providerJobId: string | null;
	scenarioId: string;
	status: StudioRunStatus;
	updatedAt: Date;
	workflowKey: string;
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
	deleteScenario(scenarioId: string): Promise<boolean>;
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
		providerEndpointId: entity.providerEndpointId,
		providerJobId: entity.providerJobId,
		scenarioId: entity.scenarioId,
		status: entity.status,
		workflowKey: entity.workflowKey,
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

export class StudioService {
	private readonly executionClient: StudioExecutionClient;
	private readonly logger: StudioLogger;
	private readonly repository: StudioRepository;

	constructor(
		repository: StudioRepository,
		executionClient: StudioExecutionClient,
		logger: StudioLogger = console,
		private readonly callbackConfig?: {
			token: string;
			url: string;
		}
	) {
		this.repository = repository;
		this.executionClient = executionClient;
		this.logger = logger;
	}

	private async resolveLatestExecution(
		run: Pick<
			StudioRunEntity,
			"generatorRunId" | "providerEndpointId" | "providerJobId" | "workflowKey"
		>,
		options?: {
			debugCorrelationId?: string;
		}
	) {
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

	async launchRun(
		input: z.input<typeof createStudioRunInputSchema>,
		options?: {
			debugCorrelationId?: string;
		}
	) {
		const parsed = createStudioRunInputSchema.parse(input);
		const scenario = await this.repository.getScenarioById(parsed.scenarioId);
		if (!scenario) {
			throw new NotFoundError(`Scenario not found: ${parsed.scenarioId}`);
		}

		const createdRun = await this.repository.createRun({
			errorSummary: null,
			generatorRunId: null,
			id: crypto.randomUUID(),
			inputImageUrl: parsed.inputImageUrl,
			providerEndpointId: null,
			providerJobId: null,
			scenarioId: scenario.id,
			status: "queued",
			workflowKey: scenario.workflowKey,
		});

		const execution = await this.executionClient.createExecution(
			{
				callback: this.callbackConfig
					? {
							context: {
								runId: createdRun.id,
							},
							token: this.callbackConfig.token,
							url: this.callbackConfig.url,
						}
					: undefined,
				inputImageUrl: parsed.inputImageUrl,
				params: scenario.params,
				prompt: scenario.prompt,
				workflowKey: scenario.workflowKey,
			},
			options
		);

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
			providerEndpointId: execution.providerEndpointId,
			providerJobId: execution.providerJobId,
			status: execution.status,
		});

		return updatedRun ? toStudioRunRecord(updatedRun) : null;
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
			providerEndpointId: input.execution.providerEndpointId,
			providerJobId: input.execution.providerJobId,
			status: input.execution.status,
		});

		return updatedRun ? toStudioRunRecord(updatedRun) : null;
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
