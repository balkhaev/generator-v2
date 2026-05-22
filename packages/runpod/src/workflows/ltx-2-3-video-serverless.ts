import { z } from "zod";
import LTX_23_I2V_API_GRAPH from "../../templates/api/ltx-2-3-i2v-lvram.json" with {
	type: "json",
};
import type { ComfyUINodeApiInput } from "../comfyui/client";
import type {
	ServerlessPayloadContext,
	ServerlessWorkflow,
} from "../workflow/definition";
import {
	deriveOutputDimensionsFromImage,
	type Ltx23Input,
	type Ltx23Output,
	ltx23InputSchema,
	probeImageDimensions,
} from "./ltx-2-3-video";

const DEFAULT_BASE_MODEL_FILENAME =
	"diffusion_models/ltx-2.3-22b-dev_transformer_only_bf16.safetensors";
const DEFAULT_LORA_FILENAME =
	"loras/ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors";
const DEFAULT_FALLBACK_WIDTH = 1280;
const DEFAULT_FALLBACK_HEIGHT = 736;
const DIM_ALIGNMENT = 32;
const MAX_OUTPUT_EDGE_PX = 1280;
const MIN_OUTPUT_EDGE_PX = 256;
const RANDOM_SEED_BITS = 24;
const SERVERLESS_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
const SERVERLESS_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_PROMPT_DEFAULT =
	"blurry, oversaturated, pixelated, low resolution, grainy, distorted, noise, compression artifacts, jpeg artifacts, glitches, watermark, text, logo, signature, copyright, subtitles, distorted sound, saturated sound, loud";

const NODE_PROMPT = "352";
const NODE_NEG_TEXT = "110";
const NODE_NOISE_FIRST = "115";
const NODE_NOISE_SECOND = "114";
const NODE_WIDTH = "292";
const NODE_HEIGHT = "293";
const NODE_LENGTH_SECONDS = "291";
const NODE_FPS = "285";
const NODE_LTXV_SCHEDULER = "206";
const NODE_LOAD_IMAGE = "167";
const NODE_LORA_LOADER = "366";
// Node ids verified via `cat ltx-2-3-i2v-lvram.json | jq` filter by class_type.
// UNETLoader (base transformer) и LoraLoaderModelOnly (distill LoRA) — единственные
// загрузчики этих типов в шаблоне, поэтому маппинг однозначный.
const NODE_UNET_LOADER = "329";
const NODE_DISTILL_LORA = "134";

export interface Ltx23ServerlessWorkflowConfig {
	/**
	 * Имя checkpoint'а transformer'а внутри `/runpod-volume/ComfyUI/models/`.
	 * По умолчанию Sulphur-2-base (uncensored fork LTX 2.3). Можно override
	 * чтобы переключить базу без редеплоя image.
	 */
	baseModelFilename?: string;
	/**
	 * Имя distill LoRA внутри `/runpod-volume/ComfyUI/models/`.
	 * Distill LoRA снижает кол-во шагов с 28 до 4-8 без значимой потери
	 * качества; обязательна для production-настройки (короткое
	 * исполнение = дешевле serverless).
	 */
	distillLoraFilename?: string;
	endpointId: string;
	id?: string;
	webhookUrl?: string;
}

export function createLtx23VideoServerlessWorkflow(
	config: Ltx23ServerlessWorkflowConfig
): ServerlessWorkflow<Ltx23Input, Ltx23Output> {
	const baseModelFilename =
		config.baseModelFilename ?? DEFAULT_BASE_MODEL_FILENAME;
	const distillLoraFilename =
		config.distillLoraFilename ?? DEFAULT_LORA_FILENAME;
	const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
		const response = await globalThis.fetch(url);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch input image (${response.status}): ${url}`
			);
		}
		return await response.arrayBuffer();
	};
	return {
		async buildPayload(
			input: Ltx23Input,
			ctx: ServerlessPayloadContext
		): Promise<Record<string, unknown>> {
			return await buildPayloadInternal({
				baseModelFilename,
				distillLoraFilename,
				fetchBytes,
				input,
				requestId: ctx.requestId,
			});
		},
		defaultPolicy: {
			executionTimeout: SERVERLESS_EXECUTION_TIMEOUT_MS,
			ttl: SERVERLESS_TTL_MS,
		},
		endpointId: config.endpointId,
		id: config.id ?? "ltx-2-3-video-serverless",
		inputSchema: ltx23InputSchema as unknown as z.ZodType<Ltx23Input>,
		mode: "serverless",
		parseOutput(raw: unknown): Ltx23Output {
			return parseServerlessOutput(raw);
		},
		webhookUrl: config.webhookUrl,
	};
}

interface BuildPayloadInternalArgs {
	baseModelFilename: string;
	distillLoraFilename: string;
	fetchBytes: (url: string) => Promise<ArrayBuffer>;
	input: Ltx23Input;
	requestId: string;
}

async function buildPayloadInternal(
	args: BuildPayloadInternalArgs
): Promise<Record<string, unknown>> {
	const parsed = ltx23InputSchema.parse(args.input);
	const imageBytes = await args.fetchBytes(parsed.inputImageUrl);
	const imageBase64 = arrayBufferToBase64(imageBytes);
	const dims = resolveDimensionsFromBytes({
		bytes: imageBytes,
		explicitHeight: parsed.height,
		explicitWidth: parsed.width,
	});
	const graph = deepCloneJson(
		LTX_23_I2V_API_GRAPH as unknown as Record<string, ComfyUINodeApiInput>
	);
	patchNodeInputs(graph, NODE_PROMPT, { value: parsed.prompt });
	patchNodeInputs(graph, NODE_NEG_TEXT, {
		text: parsed.negativePrompt || NEGATIVE_PROMPT_DEFAULT,
	});
	const seed = parsed.seed ?? randomSeed();
	patchNodeInputs(graph, NODE_NOISE_FIRST, { noise_seed: seed });
	patchNodeInputs(graph, NODE_NOISE_SECOND, { noise_seed: seed + 1 });
	patchNodeInputs(graph, NODE_WIDTH, { value: dims.width });
	patchNodeInputs(graph, NODE_HEIGHT, { value: dims.height });
	patchNodeInputs(graph, NODE_LENGTH_SECONDS, {
		value: Math.max(1, Math.ceil(parsed.numFrames / Math.max(1, parsed.fps))),
	});
	patchNodeInputs(graph, NODE_FPS, { value: parsed.fps });
	patchNodeInputs(graph, NODE_LTXV_SCHEDULER, { steps: parsed.steps });
	patchNodeInputs(graph, NODE_LOAD_IMAGE, {
		image: buildInputImageFilename(args.requestId),
	});
	patchNodeInputs(graph, NODE_UNET_LOADER, {
		unet_name: args.baseModelFilename,
	});
	patchNodeInputs(graph, NODE_DISTILL_LORA, {
		lora_name: args.distillLoraFilename,
	});
	// Civitai LoRA pre-installed on volume via warmup script — здесь мы не можем
	// тянуть LoRA на лету (нет HTTP listener'a у worker'а). Если в input заданы
	// civitai-параметры, заменяем custom LoraManager-ноду на стандартный
	// LoraLoaderModelOnly с локальным filename, ожидая что warmup-скрипт
	// предварительно положил файл на volume по пути
	// `loras/civitai-<modelId>-<versionId>.safetensors`.
	if (parsed.loraCivitaiModelId && parsed.loraCivitaiVersionId) {
		const filename = `civitai-${parsed.loraCivitaiModelId}-${parsed.loraCivitaiVersionId}.safetensors`;
		replaceLoraManagerWithStandardLoader(
			graph,
			NODE_LORA_LOADER,
			filename,
			parsed.loraScale
		);
	}
	return {
		images: [
			{
				image: `data:image/png;base64,${imageBase64}`,
				name: buildInputImageFilename(args.requestId),
			},
		],
		workflow: graph,
	};
}

const serverlessImageItemSchema = z
	.object({
		data: z.string(),
		filename: z.string().optional(),
		type: z.enum(["base64", "s3_url"]).optional(),
	})
	.passthrough();

const serverlessOutputSchema = z
	.object({
		errors: z.array(z.string()).optional(),
		images: z.array(serverlessImageItemSchema).optional(),
	})
	.passthrough();

function parseServerlessOutput(raw: unknown): Ltx23Output {
	const parsed = serverlessOutputSchema.parse(raw);
	if (parsed.errors && parsed.errors.length > 0) {
		throw new Error(
			`worker-comfyui returned errors: ${parsed.errors.join("; ")}`
		);
	}
	const first = parsed.images?.[0];
	if (!first) {
		throw new Error(
			"worker-comfyui returned no output images — workflow probably failed silently"
		);
	}
	const videoUrl =
		first.type === "s3_url"
			? first.data
			: `data:video/mp4;base64,${first.data}`;
	return {
		podConsoleUrl: "",
		podId: "",
		requestId: "",
		videoUrl,
	};
}

function buildInputImageFilename(requestId: string): string {
	const safe = requestId.replace(/[^a-zA-Z0-9_-]+/gu, "-");
	return `req-${safe}.png`;
}

function patchNodeInputs(
	graph: Record<string, ComfyUINodeApiInput>,
	nodeId: string,
	patch: Record<string, unknown>
): void {
	const node = graph[nodeId];
	if (!node) {
		return;
	}
	node.inputs = { ...node.inputs, ...patch };
}

function replaceLoraManagerWithStandardLoader(
	graph: Record<string, ComfyUINodeApiInput>,
	nodeId: string,
	loraFilename: string,
	strength: number
): void {
	const node = graph[nodeId];
	if (!node) {
		return;
	}
	const modelInput = node.inputs?.model;
	if (!Array.isArray(modelInput)) {
		return;
	}
	graph[nodeId] = {
		_meta: { title: "Civitai LoRA" },
		class_type: "LoraLoaderModelOnly",
		inputs: {
			lora_name: loraFilename,
			model: modelInput,
			strength_model: strength,
		},
	};
}

function deepCloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function randomSeed(): number {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const view = new DataView(bytes.buffer);
	return view.getUint32(0) % 2 ** RANDOM_SEED_BITS;
}

interface ResolveFromBytesArgs {
	bytes: ArrayBuffer;
	explicitHeight?: number;
	explicitWidth?: number;
}

function resolveDimensionsFromBytes(args: ResolveFromBytesArgs): {
	height: number;
	width: number;
} {
	if (args.explicitWidth && args.explicitHeight) {
		return {
			height: snapDimension(args.explicitHeight),
			width: snapDimension(args.explicitWidth),
		};
	}
	const probed = probeImageDimensions(args.bytes);
	if (!probed) {
		return {
			height: snapDimension(args.explicitHeight ?? DEFAULT_FALLBACK_HEIGHT),
			width: snapDimension(args.explicitWidth ?? DEFAULT_FALLBACK_WIDTH),
		};
	}
	return deriveOutputDimensionsFromImage(probed);
}

function snapDimension(value: number): number {
	const rounded =
		Math.round(value / DIM_ALIGNMENT) * DIM_ALIGNMENT || DIM_ALIGNMENT;
	return Math.max(MIN_OUTPUT_EDGE_PX, Math.min(MAX_OUTPUT_EDGE_PX, rounded));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i += 1) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary);
}
