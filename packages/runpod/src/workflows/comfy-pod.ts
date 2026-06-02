import type { ComfyUINodeApiInput } from "../comfyui/client";
import type {
	PodSubmitContext,
	PodSubmitResult,
	PodSuccessContext,
	PodWorkflow,
	ServerlessWorkflow,
} from "../workflow/definition";
import {
	createFluxDevImageServerlessWorkflow,
	type FluxImageInput,
	type FluxImageOutput,
} from "./flux-dev-image-serverless";
import type { Ltx23Input, Ltx23Output } from "./ltx-2-3-video";
import {
	createLtx23VideoServerlessWorkflow,
	type Ltx23ServerlessWorkflowConfig,
} from "./ltx-2-3-video-serverless";
import {
	createWanVideoServerlessWorkflow,
	type WanVideoInput,
	type WanVideoOutput,
	type WanVideoServerlessWorkflowConfig,
} from "./wan-2-2-video-serverless";

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.*)$/su;
// Засеянные на volume имена моделей (см. packages/runpod/scripts/seed-models.ts).
// Serverless LTX по умолчанию ссылается на другие имена, поэтому для пода
// переопределяем base/distill на реальные файлы.
const LTX_POD_BASE_MODEL = "sulphur_dev_fp8mixed.safetensors";
const LTX_POD_DISTILL_LORA = "sulphur_distil_lora.safetensors";

interface ServerlessPayloadShape {
	images?: Array<{ image: string; name: string }>;
	workflow?: Record<string, ComfyUINodeApiInput>;
}

interface ComfyPodWorkflowConfig<TInput, TOutput> {
	artifactContentType: string;
	/** ComfyUI base URL фиксированного пода. */
	comfyBaseUrl: string;
	id: string;
	parseArtifact(ctx: PodSuccessContext): TOutput;
	serverless: ServerlessWorkflow<TInput, TOutput>;
}

function decodeDataUrlImage(dataUrl: string): {
	bytes: Uint8Array;
	mime: string;
} {
	const match = DATA_URL_PATTERN.exec(dataUrl);
	if (!match) {
		throw new Error(
			"comfy-pod: serverless buildPayload returned a non-data-url image; cannot upload to ComfyUI"
		);
	}
	const mime = match[1] ?? "image/png";
	const base64 = match[2] ?? "";
	return { bytes: new Uint8Array(Buffer.from(base64, "base64")), mime };
}

/**
 * Оборачивает существующий serverless-воркфлоу в pod-воркфлоу для статического
 * (персистентного) ComfyUI-пода. Граф строится тем же `buildPayload`, входные
 * картинки (i2v) загружаются в ComfyUI через `/upload/image`, а результат
 * берётся из S3-артефакта (`parseArtifact`). Под не создаётся и не удаляется.
 */
export function createComfyPodWorkflow<TInput, TOutput>(
	config: ComfyPodWorkflowConfig<TInput, TOutput>
): PodWorkflow<TInput, TOutput> {
	return {
		artifactContentType: config.artifactContentType,
		async buildPrompt(
			input: TInput,
			ctx: PodSubmitContext
		): Promise<PodSubmitResult> {
			const payload = (await config.serverless.buildPayload(input, {
				requestId: ctx.requestId,
			})) as ServerlessPayloadShape;
			const graph = payload.workflow;
			if (!graph) {
				throw new Error(
					`comfy-pod (${config.id}): serverless buildPayload returned no "workflow" graph`
				);
			}
			for (const image of payload.images ?? []) {
				const { bytes } = decodeDataUrlImage(image.image);
				await ctx.client.uploadInputImage({
					bytes,
					filename: image.name,
					overwrite: true,
				});
			}
			return { prompt: graph };
		},
		id: config.id,
		inputSchema: config.serverless.inputSchema,
		mode: "pod",
		parseOutput(ctx: PodSuccessContext): TOutput {
			return config.parseArtifact(ctx);
		},
		pod: {
			comfyBaseUrl: config.comfyBaseUrl,
			imageName: "",
			networkVolumes: [],
		},
	};
}

export interface LtxVideoPodWorkflowConfig {
	baseModelFilename?: string;
	comfyBaseUrl: string;
	distillLoraFilename?: string;
	enableSpatialUpscale?: boolean;
	id?: string;
}

export function createLtxVideoPodWorkflow(
	config: LtxVideoPodWorkflowConfig
): PodWorkflow<Ltx23Input, Ltx23Output> {
	const serverlessConfig: Ltx23ServerlessWorkflowConfig = {
		baseModelFilename: config.baseModelFilename ?? LTX_POD_BASE_MODEL,
		distillLoraFilename: config.distillLoraFilename ?? LTX_POD_DISTILL_LORA,
		enableSpatialUpscale: config.enableSpatialUpscale ?? true,
		endpointId: "static-pod",
	};
	const serverless = createLtx23VideoServerlessWorkflow(serverlessConfig);
	return createComfyPodWorkflow<Ltx23Input, Ltx23Output>({
		artifactContentType: "video/mp4",
		comfyBaseUrl: config.comfyBaseUrl,
		id: config.id ?? "ltx-2-3-video",
		parseArtifact(ctx): Ltx23Output {
			return {
				podConsoleUrl: ctx.runpodPodConsoleUrl,
				podId: ctx.podId,
				requestId: ctx.requestId,
				videoUrl: ctx.artifactPublicUrl,
			};
		},
		serverless,
	});
}

export interface WanVideoPodWorkflowConfig
	extends Omit<WanVideoServerlessWorkflowConfig, "endpointId" | "id"> {
	comfyBaseUrl: string;
	id?: string;
}

export function createWanVideoPodWorkflow(
	config: WanVideoPodWorkflowConfig
): PodWorkflow<WanVideoInput, WanVideoOutput> {
	const { comfyBaseUrl, id, ...serverlessRest } = config;
	const serverless = createWanVideoServerlessWorkflow({
		...serverlessRest,
		endpointId: "static-pod",
	});
	return createComfyPodWorkflow<WanVideoInput, WanVideoOutput>({
		artifactContentType: "video/mp4",
		comfyBaseUrl,
		id: id ?? "wan-2-2-video",
		parseArtifact(ctx): WanVideoOutput {
			return {
				requestId: ctx.requestId,
				videoUrl: ctx.artifactPublicUrl,
			};
		},
		serverless,
	});
}

export interface FluxImagePodWorkflowConfig {
	checkpointFilename?: string;
	comfyBaseUrl: string;
	id?: string;
	samplerName?: string;
	scheduler?: string;
}

export function createFluxImagePodWorkflow(
	config: FluxImagePodWorkflowConfig
): PodWorkflow<FluxImageInput, FluxImageOutput> {
	const serverless = createFluxDevImageServerlessWorkflow({
		checkpointFilename: config.checkpointFilename,
		endpointId: "static-pod",
		samplerName: config.samplerName,
		scheduler: config.scheduler,
	});
	return createComfyPodWorkflow<FluxImageInput, FluxImageOutput>({
		artifactContentType: "image/png",
		comfyBaseUrl: config.comfyBaseUrl,
		id: config.id ?? "flux-dev-image",
		parseArtifact(ctx): FluxImageOutput {
			return {
				imageUrl: ctx.artifactPublicUrl,
				imageUrls: [ctx.artifactPublicUrl],
				requestId: ctx.requestId,
			};
		},
		serverless,
	});
}
