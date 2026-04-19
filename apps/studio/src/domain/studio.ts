import type {
	CreateGeneratorExecutionInput,
	ExecutionPhase,
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
import type { LoraReadRepository } from "@generator/db/repositories/lora-read";
import { normalizeBaseUrl } from "@generator/http/shared";
import { getWorkflowDefinition } from "@generator/workflows";
import { z } from "zod";

import { RunUpdatesEmitter } from "@/domain/run-updates-emitter";
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
	promptOverride: z.string().trim().min(1).max(4000).optional(),
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
	/**
	 * Транзиентные live-поля. Не персистятся в studio_run, заполняются при
	 * `applyExecutionCallback`/`launchRun`/`syncRun` из execution-payload и
	 * сразу пробрасываются в SSE. После рестарта инстанса исчезают, но
	 * `progressPct` остаётся в БД, поэтому UI всё равно увидит прогресс.
	 */
	etaMs?: number | null;
	generatorRunId: string | null;
	id: string;
	inputImageUrl: string;
	inputPersonGenerationId: string | null;
	inputPersonId: string | null;
	lastLogLine?: string | null;
	loraPersonId: string | null;
	phase?: ExecutionPhase | null;
	progressPct: number | null;
	providerEndpointId: string | null;
	providerJobId: string | null;
	queuePosition?: number | null;
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

type StudioLogger = Pick<Console, "info" | "error" | "warn">;

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
		etaMs: entity.etaMs ?? null,
		generatorRunId: entity.generatorRunId,
		id: entity.id,
		inputImageUrl: entity.inputImageUrl,
		inputPersonGenerationId: entity.inputPersonGenerationId,
		inputPersonId: entity.inputPersonId,
		lastLogLine: entity.lastLogLine ?? null,
		loraPersonId: entity.loraPersonId ?? null,
		phase: entity.phase ?? null,
		progressPct: entity.progressPct,
		providerEndpointId: entity.providerEndpointId,
		providerJobId: entity.providerJobId,
		queuePosition: entity.queuePosition ?? null,
		scenarioId: entity.scenarioId,
		status: entity.status,
		workflowKey: entity.workflowKey,
	};
}

const fileExtensionPattern = /\.[a-z0-9]+$/i;

function formatInputLabel(inputImageUrl: string): string {
	try {
		const url = new URL(inputImageUrl);
		const lastPathSegment = url.pathname
			.split("/")
			.filter(Boolean)
			.at(-1)
			?.replace(fileExtensionPattern, "");
		return lastPathSegment || url.hostname;
	} catch {
		return inputImageUrl;
	}
}

/**
 * Расширенная wire-форма run-записи, отдаваемая SSE и снапшотом студии.
 * Включает derived-поля (`scenarioName`, `inputLabel`, `artifactUrls`),
 * чтобы фронту не приходилось знать о scenarios для рендера.
 */
export interface StudioRunWireRecord extends StudioRunRecord {
	artifactUrls: string[];
	inputLabel: string;
	scenarioName: string;
}

export function runEntityToWireRecord(
	entity: StudioRunEntity,
	scenarioName: string
): StudioRunWireRecord {
	const base = toStudioRunRecord(entity);
	return {
		...base,
		artifactUrls: entity.artifacts
			.map((artifact) => artifact.url)
			.filter((url): url is string => Boolean(url)),
		inputLabel: formatInputLabel(entity.inputImageUrl),
		scenarioName,
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

/**
 * Collect URL strings sitting in workflow params under any field marked as a
 * LoRA URL (`kind: "lora-url"`). Used at run-launch time so we can map the
 * URLs back to registry entries and prepend their trigger words to the prompt.
 */
function collectLoraUrls(
	workflowKey: string,
	params: Record<string, unknown>
): string[] {
	const definition = getWorkflowDefinition(workflowKey);
	if (!definition) {
		return [];
	}
	const urls: string[] = [];
	for (const field of definition.parameterFields) {
		if (!("kind" in field) || field.kind !== "lora-url") {
			continue;
		}
		const raw = params[field.key];
		if (typeof raw !== "string") {
			continue;
		}
		const trimmed = raw.trim();
		if (trimmed.length > 0) {
			urls.push(trimmed);
		}
	}
	return urls;
}

/**
 * Build the final prompt for the generator: the user prompt prefixed with any
 * trigger words from the LoRAs the user picked. Trigger words already present
 * in the prompt (case-insensitive substring match) are skipped to avoid
 * duplication when users paste them in by hand.
 */
export function buildPromptWithTriggerWords(input: {
	prompt: string;
	triggerWords: readonly string[];
}): string {
	const promptLower = input.prompt.toLowerCase();
	const seen = new Set<string>();
	const additions: string[] = [];
	for (const raw of input.triggerWords) {
		const word = raw.trim();
		if (!word) {
			continue;
		}
		const key = word.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		if (promptLower.includes(key)) {
			continue;
		}
		additions.push(word);
	}
	if (additions.length === 0) {
		return input.prompt;
	}
	return `${additions.join(", ")}, ${input.prompt}`;
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
	private readonly loraReadRepository?: LoraReadRepository;
	private readonly outboundFetch: HttpFetch;
	private readonly personsApiBaseUrl?: string;
	private readonly repository: StudioRepository;
	readonly runUpdatesEmitter = new RunUpdatesEmitter<StudioRunWireRecord>();

	constructor(
		repository: StudioRepository,
		executionClient: StudioExecutionClient,
		logger: StudioLogger = console,
		callbackConfig?: { token: string; url?: string },
		resolver?: {
			fetchImpl?: HttpFetch;
			loraReadRepository?: LoraReadRepository;
			personsApiBaseUrl?: string;
		}
	) {
		this.repository = repository;
		this.executionClient = executionClient;
		this.logger = logger;
		this.callbackConfig = callbackConfig;
		this.personsApiBaseUrl = resolver?.personsApiBaseUrl?.trim();
		this.outboundFetch = resolver?.fetchImpl ?? fetch;
		this.loraReadRepository = resolver?.loraReadRepository;
	}

	/**
	 * Look up the registry entries for the LoRA URLs picked in this run and
	 * prepend their trigger words to the prompt. Civitai LoRAs only activate
	 * when their `trainedWords` show up in the prompt; previously studio sent
	 * the bare user prompt and the LoRA had no effect. Falls back to the
	 * original prompt when no registry repo is configured (used by tests) or
	 * none of the URLs match a registry entry (e.g. ad-hoc URL the user pasted
	 * directly).
	 */
	private async injectLoraTriggerWords(input: {
		params: Record<string, unknown>;
		prompt: string;
		runId: string;
		workflowKey: string;
	}): Promise<string> {
		if (!this.loraReadRepository) {
			return input.prompt;
		}
		const urls = collectLoraUrls(input.workflowKey, input.params);
		if (urls.length === 0) {
			return input.prompt;
		}
		let entries: Awaited<ReturnType<LoraReadRepository["getByS3Urls"]>>;
		try {
			entries = await this.loraReadRepository.getByS3Urls(urls);
		} catch (error) {
			// Триггер-слова — это обогащение, а не критический шаг. Если запрос в БД
			// упал (схема не накатилась, потерян коннект и т.п.) — лучше отправить
			// исходный промпт, чем валить весь launchRun.
			this.logger.warn?.("studio.lora.trigger-lookup.failed", {
				error: error instanceof Error ? error.message : "unknown",
				runId: input.runId,
			});
			return input.prompt;
		}
		const triggerWords: string[] = [];
		for (const entry of entries) {
			for (const word of entry.triggerWords) {
				triggerWords.push(word);
			}
		}
		if (triggerWords.length === 0) {
			return input.prompt;
		}
		const augmented = buildPromptWithTriggerWords({
			prompt: input.prompt,
			triggerWords,
		});
		if (augmented !== input.prompt) {
			this.logger.info("studio.lora.trigger-words.applied", {
				added: augmented.length - input.prompt.length,
				loraIds: entries.map((entry) => entry.id),
				runId: input.runId,
			});
		}
		return augmented;
	}

	/**
	 * Тонкая обёртка над репозиторием, чтобы наружу можно было получить
	 * snapshot активных runs для SSE без дублирования логики (использует
	 * тот же wire-mapper, что и `createStudioSnapshot`).
	 */
	async listActiveWireRuns(limit = 50): Promise<StudioRunWireRecord[]> {
		const runs = await this.repository.listActiveRuns(limit);
		const scenarioNames = await this.scenarioNamesFor(runs);
		return runs.map((run) =>
			runEntityToWireRecord(
				run,
				scenarioNames.get(run.scenarioId) ?? "Unknown scenario"
			)
		);
	}

	private async scenarioNamesFor(
		runs: Pick<StudioRunEntity, "scenarioId">[]
	): Promise<Map<string, string>> {
		if (runs.length === 0) {
			return new Map();
		}
		const ids = new Set(runs.map((run) => run.scenarioId));
		const entries = await Promise.all(
			Array.from(ids).map(async (id) => {
				const scenario = await this.repository.getScenarioById(id);
				return [id, scenario?.name ?? "Unknown scenario"] as const;
			})
		);
		return new Map(entries);
	}

	private async emitRunUpdate(entity: StudioRunEntity): Promise<void> {
		try {
			const scenario = await this.repository.getScenarioById(entity.scenarioId);
			const record = runEntityToWireRecord(
				entity,
				scenario?.name ?? "Unknown scenario"
			);
			this.runUpdatesEmitter.emit(record);
		} catch (error) {
			this.logger.error("studio.run-emit.failed", {
				error: error instanceof Error ? error.message : "unknown",
				runId: entity.id,
			});
		}
	}

	/**
	 * Дополняет entity данными, которые приходят с execution-payload
	 * (etaMs/phase/queuePosition/lastLogLine), но не персистятся.
	 * После сохранения в БД мы получаем «чистую» сущность без этих полей —
	 * этот хелпер мерджит их обратно перед публикацией в SSE.
	 */
	private withExecutionLiveFields<T extends StudioRunEntity>(
		entity: T,
		execution: Pick<
			GeneratorExecutionRecord,
			"etaMs" | "lastLogLine" | "phase" | "queuePosition"
		> | null
	): T {
		if (!execution) {
			return entity;
		}
		return {
			...entity,
			etaMs: execution.etaMs ?? null,
			lastLogLine: execution.lastLogLine ?? null,
			phase: execution.phase ?? null,
			queuePosition: execution.queuePosition ?? null,
		};
	}

	/**
	 * Накладывает данные из свежего execution-payload поверх БД-снапшота run'а
	 * БЕЗ записи в БД. Используется для SSE-эмита из web-инстанса, который
	 * слушает Kafka, но не персистит (этим занимается studio-worker).
	 *
	 * Без этого overlay'я `processStreamEvent` отдавал бы клиентам status и
	 * artifacts из БД, которые ещё не успел проапдейтить worker — и на UI run
	 * оставался в "Generating", пока не сделают F5. См. комментарий к
	 * `processStreamEvent`.
	 */
	private overlayExecutionOnEntity(
		entity: StudioRunEntity,
		execution: GeneratorExecutionRecord
	): StudioRunEntity {
		const executionStatus = execution.status as StudioRunStatus;
		const nextStatus = isStatusProgression(entity.status, executionStatus)
			? executionStatus
			: entity.status;
		const executionArtifacts = mapExecutionToArtifacts(
			entity.id,
			execution
		).map((artifact) => ({
			createdAt: new Date(),
			id: artifact.id,
			kind: artifact.kind,
			metadata: artifact.metadata,
			runId: artifact.runId,
			url: artifact.url,
		}));
		const nextArtifacts =
			executionArtifacts.length > 0 ? executionArtifacts : entity.artifacts;
		const nextCompletedAt =
			nextStatus === "succeeded" || nextStatus === "failed"
				? (entity.completedAt ?? new Date())
				: entity.completedAt;
		return {
			...entity,
			artifacts: nextArtifacts,
			completedAt: nextCompletedAt,
			errorSummary: execution.errorSummary ?? entity.errorSummary,
			generatorRunId: execution.id ?? entity.generatorRunId,
			progressPct: executionProgressPct(execution) ?? entity.progressPct,
			providerEndpointId:
				execution.providerEndpointId ?? entity.providerEndpointId,
			providerJobId: execution.providerJobId ?? entity.providerJobId,
			status: nextStatus,
		};
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

	async listRunsWire(): Promise<StudioRunWireRecord[]> {
		const runs = await this.repository.listRuns();
		const scenarioNames = await this.scenarioNamesFor(runs);
		return runs.map((run) =>
			runEntityToWireRecord(
				run,
				scenarioNames.get(run.scenarioId) ?? "Unknown scenario"
			)
		);
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

		const basePrompt = parsed.promptOverride ?? scenario.prompt;
		const finalPrompt = await this.injectLoraTriggerWords({
			params: mergedExecutionParams,
			prompt: basePrompt,
			runId: createdRun.id,
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
					prompt: finalPrompt,
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

		const enriched = this.withExecutionLiveFields(updated, execution);
		await this.emitRunUpdate(enriched);
		return toStudioRunRecord(enriched);
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

		if (!updatedRun) {
			return null;
		}
		const enriched = this.withExecutionLiveFields(updatedRun, execution);
		await this.emitRunUpdate(enriched);
		return toStudioRunRecord(enriched);
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
		if (updated) {
			await this.emitRunUpdate(updated);
		}
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

		if (!updatedRun) {
			return null;
		}
		const enriched = this.withExecutionLiveFields(updatedRun, input.execution);
		await this.emitRunUpdate(enriched);
		return toStudioRunRecord(enriched);
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
					const enriched = this.withExecutionLiveFields(updated, execution);
					await this.emitRunUpdate(enriched);
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

	/**
	 * Эмитит SSE-обновление run'а на основании свежего execution-payload из
	 * Kafka. Запускается на web-инстансах (group-id `studio-web-stream-…`),
	 * чтобы push'ить состояние клиентам без ожидания, пока studio-worker
	 * (отдельный процесс) персистит апдейт в БД.
	 *
	 * ВАЖНО: статус/прогресс/артефакты берутся из execution, а не из БД,
	 * иначе SSE-сообщение придёт со stale-полями (run остаётся в
	 * "Generating", пока пользователь не сделает F5 — тогда snapshot из БД,
	 * уже обновлённой воркером, исправит UI).
	 */
	async processStreamEvent(input: {
		context: Record<string, unknown>;
		execution: GeneratorExecutionRecord;
	}): Promise<void> {
		const runId =
			typeof input.context.runId === "string" ? input.context.runId : null;
		if (!runId) {
			return;
		}
		const run = await this.repository.getRunById(runId);
		if (!run) {
			return;
		}
		const overlaid = this.overlayExecutionOnEntity(run, input.execution);
		const enriched = this.withExecutionLiveFields(overlaid, input.execution);
		await this.emitRunUpdate(enriched);
	}
}
