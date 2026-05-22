import type { S3ObjectStat } from "@generator/storage";
import type { z } from "zod";

import type { ComfyUIClient, ComfyUINodeApiInput } from "../comfyui/client";

export type WorkflowMode = "serverless" | "pod";

/**
 * `executionTimeout` (мс) — максимальное время активной обработки job'а
 * worker'ом. RunPod default = 10 мин, что часто слишком мало для SDXL/video.
 * `ttl` (мс) — полное время жизни job'а от submit до удаления (включая queue).
 * Без явных значений RunPod использует 24h ttl, что прячет capacity-залипания.
 *
 * `lowPriority=true` запрещает scale-out по этому job'у — полезно для
 * health-ping'ов чтобы они не поднимали лишние воркеры.
 */
export interface RunpodPolicy {
	executionTimeout?: number;
	lowPriority?: boolean;
	ttl?: number;
}

/**
 * Warm-up payload и расписание для конкретного workflow. WarmupRunner
 * периодически шлёт его на endpoint чтобы держать хотя бы один worker idle.
 * Цена: ~1 cold start в `intervalMs`, что в разы дешевле, чем активировать
 * `min workers ≥ 1` в RunPod console (тот тарифицируется посекундно даже без
 * нагрузки).
 *
 * Payload должен быть валидным input'ом workflow'а (worker отвечает что-то
 * тривиальное, например health-ping mode). Если workflow не умеет в no-op,
 * лучше использовать `min workers` в console.
 */
export interface ServerlessWarmup<TInput> {
	/** Билдер payload'а — должен пройти `inputSchema.parse`. */
	buildInput(): TInput;
	/**
	 * Дополнительная policy для warm-up job'а. По умолчанию engine выставляет
	 * `lowPriority: true` чтобы warm-up не дёргал scale-out.
	 */
	policy?: RunpodPolicy;
	/**
	 * Опциональный фильтр: warm-up отправляется только если health показывает
	 * idle === 0 (= worker'ов нет, следующий запрос придёт на cold start).
	 * Default = true: экономим на пустых пингах.
	 */
	skipWhenWarmersAvailable?: boolean;
	/** Сколько ждать /runsync ответа (мс). Default 15000. */
	waitMs?: number;
}

export interface ServerlessPayloadContext {
	/**
	 * Opaque request id (= executionId на стороне generator-worker), стабильный
	 * между retry'ями одной задачи. Workflow'ы используют его как seed для
	 * детерминированных имён файлов (например `req-{id}.png` для аплоада
	 * входной картинки), чтобы worker мог matchи'ть payload'у `images[]`
	 * со ссылками внутри ComfyUI graph'а.
	 */
	requestId: string;
}

export interface ServerlessWorkflow<TInput, TOutput> {
	/**
	 * Билдит RunPod `input` payload. Может быть async — например, скачивание
	 * входной картинки + base64-encoding для voiceover/video workflow'ов,
	 * где worker'у нужно отдать данные inline (без HTTP listener'а у serverless
	 * worker'а нет API подгрузки файлов после старта job'а).
	 */
	buildPayload(
		input: TInput,
		ctx?: ServerlessPayloadContext
	): Record<string, unknown> | Promise<Record<string, unknown>>;
	/** Defaults применяются к каждому submit/runSync (можно переопределить per-call). */
	defaultPolicy?: RunpodPolicy;
	endpointId: string;
	id: string;
	inputSchema: z.ZodType<TInput>;
	mode: "serverless";
	parseOutput(raw: unknown): TOutput;
	/** Legacy alias — оставлен для совместимости со старыми workflows. */
	policy?: RunpodPolicy;
	/**
	 * Если задано, `submit()` будет использовать `/runsync?wait=…` — клиент
	 * получит терминальный output в одном round-trip без поллинга.
	 *
	 * Применимо к коротким workflow (≤ 30 сек активной обработки), потому что
	 * RunPod держит коннект максимум 300 секунд.
	 */
	runSync?: {
		enabled: boolean;
		waitMs?: number;
	};
	/** Декларация warm-up'а — используется `createServerlessWarmupRunner`. */
	warmup?: ServerlessWarmup<TInput>;
	/**
	 * Webhook URL который RunPod дёрнет при завершении job'а. Поверх любого
	 * webhook'а engine всё равно умеет поллить — это просто ускоряет реакцию.
	 */
	webhookUrl?: string;
}

/**
 * Описание одного network-volume'а: RunPod ID + список GPU-типов, доступных
 * в DC этого volume. Network volume привязан к одному датацентру, и под
 * можно поднять только в нём. Несколько volume'ов = расширенный пул DC×GPU.
 */
export interface PodNetworkVolume {
	/** GPU type id'ы RunPod (e.g. "NVIDIA RTX A6000"), доступные в DC. */
	gpuTypeIds: string[];
	/** Опциональная человекочитаемая метка (e.g. "EU-RO-1") для логов. */
	label?: string;
	/** RunPod ID network volume'а; DC определяется автоматически. */
	networkVolumeId: string;
}

/**
 * Спецификация запускаемого pod'а — только то, что отдаём в RunPod REST.
 * `dockerStartCmd` намеренно не закладывается: template'у поверх образа
 * `ls250824/run-comfyui-ltx` и подобных, его перекрывать нельзя — иначе их
 * provisioning не запускается, и каждый pod заново качает все модели.
 *
 * `networkVolumes` обязательны: модели кешируются на volume, без него каждый
 * cold start качает ~40 ГБ из HuggingFace. Несколько volume'ов перебираются
 * по очереди при `no capacity`.
 */
export interface PodSpec {
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	gpuCount?: number;
	imageName: string;
	/**
	 * Сколько времени (мс) держать pod в warm-pool после успешного inference,
	 * прежде чем reaper его уничтожит. Burst-запросы в этом окне переиспользуют
	 * уже загруженного в VRAM ComfyUI вместо холодного бута + чтения 40 ГБ из
	 * NFS. 0 / undefined = старое поведение (cleanup сразу после артефакта).
	 */
	keepAliveMs?: number;
	namePrefix?: string;
	networkVolumes: PodNetworkVolume[];
	templateId?: string;
	timeoutMs?: number;
	volumeInGb?: number;
}

export interface PodPrepareArgs<TInput> {
	/** Civitai API key proxied from the engine; used for Lora Manager
	 * bootstrap when env-based auto-detection didn't kick in. */
	civitaiApiKey?: string;
	client: ComfyUIClient;
	downloadId: string;
	input: TInput;
	requestId: string;
}

export interface PodPrepareStatus {
	errorSummary?: string;
	progressPct?: number;
	ready: boolean;
}

export interface PodSubmitContext {
	client: ComfyUIClient;
	clientId: string;
	requestId: string;
}

export interface PodSubmitResult {
	outputNodeId?: string;
	prompt: Record<string, ComfyUINodeApiInput>;
}

export interface PodSuccessContext {
	artifactPublicUrl: string;
	artifactStat: S3ObjectStat;
	podId: string;
	requestId: string;
	runpodPodConsoleUrl: string;
}

export interface PodWorkflow<TInput, TOutput> {
	/** Mime-type финального артефакта; используется для S3 заливки. */
	artifactContentType: string;
	/**
	 * Дополнительный env, который надо передать в pod (поверх PASSWORD/
	 * CIVITAI_TOKEN/HF_TOKEN, которые добавляет engine).
	 */
	buildEnv?(input: TInput): Record<string, string>;
	/**
	 * Вернуть API workflow для POST /prompt. Может быть async — короткие
	 * lookup'ы в LM/Civitai (например резолв реального filename LoRA после
	 * download) тут уместны. Длинные операции (загрузка чекпоинтов, image
	 * upload) — в `prepare`.
	 */
	buildPrompt(
		input: TInput,
		ctx: PodSubmitContext
	): PodSubmitResult | Promise<PodSubmitResult>;
	id: string;
	inputSchema: z.ZodType<TInput>;
	mode: "pod";
	parseOutput(ctx: PodSuccessContext): TOutput;
	pod: PodSpec;
	/**
	 * Идемпотентный шаг между готовностью ComfyUI и сабмитом /prompt:
	 * скачивание LoRA, аплоад входных изображений, etc. Возвращает прогресс,
	 * чтобы engine мог корректно репортить state в worker.
	 */
	prepare?(args: PodPrepareArgs<TInput>): Promise<PodPrepareStatus>;
}

export type WorkflowDefinition<TInput, TOutput> =
	| ServerlessWorkflow<TInput, TOutput>
	| PodWorkflow<TInput, TOutput>;

export type AnyWorkflowDefinition = WorkflowDefinition<unknown, unknown>;
