import type { S3ObjectStat } from "@generator/storage";
import type { z } from "zod";

import type { ComfyUIClient, ComfyUINodeApiInput } from "../comfyui/client";

export type WorkflowMode = "serverless" | "pod";

export interface RunpodPolicy {
	executionTimeout?: number;
	lowPriority?: boolean;
	ttl?: number;
}

export interface ServerlessWorkflow<TInput, TOutput> {
	buildPayload(input: TInput): Record<string, unknown>;
	endpointId: string;
	id: string;
	inputSchema: z.ZodType<TInput>;
	mode: "serverless";
	parseOutput(raw: unknown): TOutput;
	policy?: RunpodPolicy;
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
