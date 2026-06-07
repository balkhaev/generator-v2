import type {
	ExecutionPhase,
	GeneratorExecutionRecord,
	RunStatus,
	ScenarioParamValue,
	WorkflowField,
	WorkflowSummary,
} from "./generator";

export interface StudioScenarioRecord {
	createdAt?: string;
	generatorScenarioId?: string | null;
	id: string;
	name: string;
	params?: Record<string, ScenarioParamValue>;
	prompt: string;
	promptSource?: StudioPromptSource | null;
	updatedAt?: string;
	workflowKey: string;
}

export type StudioPromptEnhanceMode = "text" | "vision";

export interface StudioPromptSource {
	enhancedPrompt: string;
	mode?: StudioPromptEnhanceMode;
	originalPrompt: string;
}

export interface CreateStudioScenarioInput {
	name: string;
	params?: Record<string, ScenarioParamValue>;
	prompt: string;
	promptSource?: StudioPromptSource | null;
	workflowKey: string;
}

export interface StudioArtifactRecord {
	kind?: string;
	url?: string | null;
}

export interface StudioRunRecord {
	artifacts?: StudioArtifactRecord[];
	createdAt?: string;
	errorSummary?: string | null;
	/** Грубая оценка остатка в миллисекундах. Заполняется на live-обновлениях. */
	etaMs?: number | null;
	/**
	 * Ожидаемая длительность всего ран'а из workflow-каталога (мс).
	 * Используется фронтом для локальной soft-progress интерполяции между
	 * Kafka-апдейтами — провайдеры вроде wan-2-2 не отдают промежуточные
	 * step-логи, и без этой подсказки прогресс-бар замирал бы на floor'е.
	 */
	expectedDurationMs?: number | null;
	generatorRunId?: string | null;
	id: string;
	inputImageUrl: string;
	inputPersonGenerationId?: string | null;
	inputPersonId?: string | null;
	/** Последняя строка лога провайдера, если есть. */
	lastLogLine?: string | null;
	/** Персона, чей LoRA подставлен в params при запуске (Studio → Cast). */
	loraPersonId?: string | null;
	/** Дискретная фаза для UI (queued/in_queue/running/finalizing/...). */
	phase?: ExecutionPhase | null;
	/** 0–100 с generator-api; null пока нет значения. */
	progressPct?: number | null;
	providerEndpointId?: string | null;
	providerJobId?: string | null;
	/** Позиция в очереди провайдера (только пока phase = in_queue). */
	queuePosition?: number | null;
	scenarioId: string;
	status: RunStatus;
	workflowKey: string;
}

/** Ответ debug-эндпоинтов studio / admin: ран + execution из generator. */
export interface StudioRunDebugBundle {
	execution: GeneratorExecutionRecord | null;
	executionError: string | null;
	run: StudioRunRecord;
}

export interface CreateStudioRunInput {
	inputImageUrl?: string;
	inputPersonGenerationId?: string | null;
	inputPersonId?: string | null;
	/** Подставить loraUrl этой персоны в params (нужен PERSONS_API_URL на studio-api). */
	loraPersonId?: string | null;
	/**
	 * Разовый override промта сценария на этот run (например, результат
	 * vision-enhance под конкретное input image). Если пустой — используем
	 * scenario.prompt как обычно.
	 */
	promptOverride?: string;
	/** Исходный prompt пользователя до Enhance, если текущий prompt был переписан. */
	promptSource?: StudioPromptSource | null;
	scenarioId: string;
}

/**
 * Build the final prompt for the generator: the user prompt prefixed with any
 * trigger words from the selected LoRAs. Trigger words already present in the
 * prompt are skipped case-insensitively to avoid duplication.
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

export type StudioShotArtifactKind = "image" | "video" | "audio";

export interface StudioShotRecord {
	artifactKind: StudioShotArtifactKind;
	artifactUrl: string;
	createdAt: string;
	id: string;
	note: string | null;
	personGenerationId: string | null;
	personId: string | null;
	runId: string;
	scenarioId: string;
}

export interface CreateStudioShotInput {
	artifactKind?: StudioShotArtifactKind;
	artifactUrl: string;
	note?: string | null;
	personGenerationId?: string | null;
	personId?: string | null;
	runId: string;
}

export interface StudioInputAssetRecord {
	contentType: string;
	fileName: string;
	sizeBytes: number;
	storage: "local" | "s3";
	url: string;
}

export interface StudioWorkflowSummary extends WorkflowSummary {
	parameterFields: readonly WorkflowField[];
}

export interface StudioSnapshot {
	runs: StudioRunRecord[];
	scenarios: StudioScenarioRecord[];
	shots: StudioShotRecord[];
	source: "server";
	warnings: string[];
	workflows: StudioWorkflowSummary[];
}

/**
 * Wire-форма run-записи, которую studio-сервис отдаёт по HTTP (snapshot) и SSE.
 * Базовая запись плюс derived-поля, чтобы клиенту не нужно было знать о
 * scenarios для рендера. Источник правды для внешних потребителей (ai-girl).
 */
export interface StudioRunWireRecord extends StudioRunRecord {
	artifactUrls: string[];
	inputLabel: string;
	scenarioName: string;
}

/** Wire-форма shot-записи: базовая запись + имя сценария для рендера. */
export interface StudioShotWireRecord extends StudioShotRecord {
	scenarioName: string;
}

/** Wire-форма снапшота студии: runs/shots в derived-форме. */
export interface StudioSnapshotWire {
	runs: StudioRunWireRecord[];
	scenarios: StudioScenarioRecord[];
	shots: StudioShotWireRecord[];
	source: "server";
	warnings: string[];
	workflows: StudioWorkflowSummary[];
}
