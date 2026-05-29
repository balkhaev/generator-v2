import { z } from "zod";
import WAN_22_I2V_API_GRAPH from "../../templates/api/wan-2-2-i2v.json" with {
	type: "json",
};
import type { ComfyUINodeApiInput } from "../comfyui/client";
import type {
	ServerlessPayloadContext,
	ServerlessWorkflow,
} from "../workflow/definition";
import { probeImageDimensions } from "./ltx-2-3-video";

// Имена моделей внутри `/runpod-volume/ComfyUI/models/`. По умолчанию —
// официальные Comfy-Org repackaged fp8-веса (дешевле по VRAM и быстрее
// холодного старта на A5000/4090). Можно override через config/env без
// редеплоя worker-образа, т.к. модели живут на network volume, а не в image.
const DEFAULT_HIGH_NOISE_MODEL =
	"wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors";
const DEFAULT_LOW_NOISE_MODEL =
	"wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors";
const DEFAULT_TEXT_ENCODER = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
const DEFAULT_VAE = "wan_2.1_vae.safetensors";

const DEFAULT_FALLBACK_WIDTH = 480;
const DEFAULT_FALLBACK_HEIGHT = 832;
const DEFAULT_FRAMES = 81;
const DEFAULT_FPS = 16;
const DEFAULT_STEPS = 20;
const DEFAULT_CFG_SCALE = 3.5;
const DEFAULT_LORA_SCALE = 1;
const DEFAULT_SHIFT = 8;
// Граница между high-noise и low-noise экспертами. Wan 2.2 MoE: первый
// сэмплер крутит шаги [0, boundary*steps) с high-noise моделью, второй —
// [boundary*steps, steps) с low-noise. 0.5 — рекомендованный дефолт.
const NOISE_BOUNDARY = 0.5;
// Wan latent patchify требует кратность 16 по обеим осям; длина — 4n+1
// (один опорный кадр + блоки по 4). Иначе WanImageToVideo/VAEDecode падают.
const DIM_ALIGNMENT = 16;
const FRAME_ALIGNMENT = 4;
const MAX_OUTPUT_EDGE_PX = 1280;
const MIN_OUTPUT_EDGE_PX = 256;
const MIN_FRAMES = 17;
const MAX_FRAMES = 121;
const RANDOM_SEED_BITS = 24;
const SERVERLESS_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
const SERVERLESS_TTL_MS = 60 * 60 * 1000;
/** Trusted S3 sample — тот же, что у LTX smoke. */
const WARMUP_INPUT_IMAGE_URL =
	"https://hel1.your-objectstorage.com/generator/studio-inputs/smoke/sample.png";
const WARMUP_FRAMES = 17;
const WARMUP_EXECUTION_TIMEOUT_MS = 12 * 60 * 1000;
const WARMUP_TTL_MS = 15 * 60 * 1000;
const NEGATIVE_PROMPT_DEFAULT =
	"色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 风格, 作品, 画作, 画面, 静止, 整体发灰, 最差质量, 低质量, JPEG压缩残留, 丑陋的, 残缺的, 多余的手指, 画得不好的手部, 画得不好的脸部, 畸形的, 毁容的, 形态畸形的肢体, 手指融合, 静止不动的画面, 杂乱的背景, 三条腿, 背景人很多, 倒着走, blurry, low quality, distorted, watermark, text, logo";

// Node ids см. templates/api/wan-2-2-i2v.json.
const NODE_UNET_HIGH = "10";
const NODE_UNET_LOW = "11";
const NODE_CLIP_LOADER = "12";
const NODE_VAE_LOADER = "13";
const NODE_LOAD_IMAGE = "14";
const NODE_POS_TEXT = "20";
const NODE_NEG_TEXT = "21";
const NODE_MODEL_SAMPLING_HIGH = "30";
const NODE_MODEL_SAMPLING_LOW = "31";
const NODE_WAN_I2V = "40";
const NODE_KSAMPLER_HIGH = "50";
const NODE_KSAMPLER_LOW = "51";
const NODE_VAE_DECODE = "60";
const NODE_VHS_MP4 = "140";
// Injected output fallbacks (зарезервированный диапазон > 9000, чтобы не
// конфликтовать с базовым графом).
const NODE_FALLBACK_SAVE_IMAGE = "9001";
const NODE_FALLBACK_SAVE_WEBP = "9002";
// Injected LoRA loaders. high/low-эксперты используют РАЗНЫЕ инстансы (Wan
// 2.2 требует применять LoRA на обе ветви независимо).
const NODE_ACCEL_LORA_HIGH = "9101";
const NODE_ACCEL_LORA_LOW = "9102";
const NODE_SCENARIO_LORA_HIGH = "9111";
const NODE_SCENARIO_LORA_LOW = "9112";

const finiteNumber = z.coerce.number().finite();
const finiteInt = z.coerce.number().int().finite();

export const wanVideoInputSchema = z.object({
	prompt: z.string().min(1),
	negativePrompt: z.string().default(""),
	// width/height optional: если не заданы, выводим из самого inputImage
	// (snap-to-16, cap MAX_OUTPUT_EDGE_PX), сохраняя aspect ratio.
	width: finiteInt.optional(),
	height: finiteInt.optional(),
	numFrames: finiteInt.default(DEFAULT_FRAMES),
	fps: finiteInt.default(DEFAULT_FPS),
	steps: finiteInt.default(DEFAULT_STEPS),
	cfgScale: finiteNumber.default(DEFAULT_CFG_SCALE),
	seed: finiteInt.optional(),
	inputImageUrl: z.string().url(),
	loraCivitaiModelId: finiteInt.optional(),
	loraCivitaiVersionId: finiteInt.optional(),
	/** Pre-provisioned high-noise LoRA filename under `models/loras/`. */
	loraHighFilename: z.string().min(1).optional(),
	/** Pre-provisioned low-noise LoRA filename under `models/loras/`. */
	loraLowFilename: z.string().min(1).optional(),
	loraScale: finiteNumber.default(DEFAULT_LORA_SCALE),
});

export type WanVideoInput = z.input<typeof wanVideoInputSchema>;
type WanVideoParsed = z.output<typeof wanVideoInputSchema>;

export interface WanVideoOutput {
	requestId: string;
	videoUrl: string;
}

export interface WanVideoServerlessWorkflowConfig {
	/**
	 * Опциональные acceleration-LoRA (lightx2v 4-step и подобные). Применяются
	 * на ОБЕ ветви эксперта первыми в цепочке. Файлы должны лежать на network
	 * volume в `models/loras/`. Имена high/low — раздельные.
	 */
	accelLoraHighFilename?: string;
	accelLoraLowFilename?: string;
	accelLoraStrength?: number;
	cfgScaleDefault?: number;
	enableWarmup?: boolean;
	endpointId: string;
	highNoiseModelFilename?: string;
	id?: string;
	lowNoiseModelFilename?: string;
	/** sampler/scheduler для обоих KSamplerAdvanced. */
	samplerName?: string;
	scheduler?: string;
	/** ModelSamplingSD3 shift (sigma shift). I2V рекомендуют 8.0. */
	shift?: number;
	textEncoderFilename?: string;
	vaeFilename?: string;
	webhookUrl?: string;
}

export function createWanVideoServerlessWorkflow(
	config: WanVideoServerlessWorkflowConfig
): ServerlessWorkflow<WanVideoInput, WanVideoOutput> {
	const enableWarmup = config.enableWarmup ?? false;
	const settings: ResolvedSettings = {
		accelLoraHighFilename: config.accelLoraHighFilename,
		accelLoraLowFilename: config.accelLoraLowFilename,
		accelLoraStrength: config.accelLoraStrength ?? DEFAULT_LORA_SCALE,
		highNoiseModelFilename:
			config.highNoiseModelFilename ?? DEFAULT_HIGH_NOISE_MODEL,
		lowNoiseModelFilename:
			config.lowNoiseModelFilename ?? DEFAULT_LOW_NOISE_MODEL,
		samplerName: config.samplerName ?? "euler",
		scheduler: config.scheduler ?? "simple",
		shift: config.shift ?? DEFAULT_SHIFT,
		textEncoderFilename: config.textEncoderFilename ?? DEFAULT_TEXT_ENCODER,
		vaeFilename: config.vaeFilename ?? DEFAULT_VAE,
	};
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
			input: WanVideoInput,
			ctx: ServerlessPayloadContext
		): Promise<Record<string, unknown>> {
			return await buildPayloadInternal({
				fetchBytes,
				input,
				requestId: ctx.requestId,
				settings,
			});
		},
		defaultPolicy: {
			executionTimeout: SERVERLESS_EXECUTION_TIMEOUT_MS,
			ttl: SERVERLESS_TTL_MS,
		},
		endpointId: config.endpointId,
		id: config.id ?? "wan-2-2-video-serverless",
		inputSchema: wanVideoInputSchema as unknown as z.ZodType<WanVideoInput>,
		mode: "serverless",
		parseOutput(raw: unknown): WanVideoOutput {
			return parseServerlessOutput(raw);
		},
		warmup: enableWarmup
			? {
					buildInput() {
						return {
							cfgScale: 1,
							fps: 8,
							height: 256,
							inputImageUrl: WARMUP_INPUT_IMAGE_URL,
							negativePrompt: "",
							numFrames: WARMUP_FRAMES,
							prompt: "warmup",
							steps: 2,
							width: 256,
						} satisfies WanVideoInput;
					},
					policy: {
						executionTimeout: WARMUP_EXECUTION_TIMEOUT_MS,
						lowPriority: true,
						ttl: WARMUP_TTL_MS,
					},
					skipWhenWarmersAvailable: true,
					waitMs: 30_000,
				}
			: undefined,
		webhookUrl: config.webhookUrl,
	};
}

interface ResolvedSettings {
	accelLoraHighFilename?: string;
	accelLoraLowFilename?: string;
	accelLoraStrength: number;
	highNoiseModelFilename: string;
	lowNoiseModelFilename: string;
	samplerName: string;
	scheduler: string;
	shift: number;
	textEncoderFilename: string;
	vaeFilename: string;
}

interface BuildPayloadInternalArgs {
	fetchBytes: (url: string) => Promise<ArrayBuffer>;
	input: WanVideoInput;
	requestId: string;
	settings: ResolvedSettings;
}

async function buildPayloadInternal(
	args: BuildPayloadInternalArgs
): Promise<Record<string, unknown>> {
	const parsed = wanVideoInputSchema.parse(args.input);
	const imageBytes = await args.fetchBytes(parsed.inputImageUrl);
	const imageBase64 = arrayBufferToBase64(imageBytes);
	const dims = resolveDimensionsFromBytes({
		bytes: imageBytes,
		explicitHeight: parsed.height,
		explicitWidth: parsed.width,
	});
	const length = snapFrameCount(parsed.numFrames);
	const graph = deepCloneJson(
		WAN_22_I2V_API_GRAPH as unknown as Record<string, ComfyUINodeApiInput>
	);
	patchModels(graph, args.settings);
	patchPromptsAndImage(graph, parsed, args.requestId);
	patchDimensions(graph, dims, length);
	patchSamplers(graph, parsed, args.settings);
	patchFps(graph, parsed.fps);
	applyLoraChains(graph, parsed, args.settings);
	ensureFallbackSaveImage(graph);
	ensureFallbackSaveAnimatedWebp(graph, parsed.fps);
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

function patchModels(
	graph: Record<string, ComfyUINodeApiInput>,
	settings: ResolvedSettings
): void {
	patchNodeInputs(graph, NODE_UNET_HIGH, {
		unet_name: settings.highNoiseModelFilename,
	});
	patchNodeInputs(graph, NODE_UNET_LOW, {
		unet_name: settings.lowNoiseModelFilename,
	});
	patchNodeInputs(graph, NODE_CLIP_LOADER, {
		clip_name: settings.textEncoderFilename,
	});
	patchNodeInputs(graph, NODE_VAE_LOADER, {
		vae_name: settings.vaeFilename,
	});
	patchNodeInputs(graph, NODE_MODEL_SAMPLING_HIGH, { shift: settings.shift });
	patchNodeInputs(graph, NODE_MODEL_SAMPLING_LOW, { shift: settings.shift });
}

function patchPromptsAndImage(
	graph: Record<string, ComfyUINodeApiInput>,
	parsed: WanVideoParsed,
	requestId: string
): void {
	patchNodeInputs(graph, NODE_POS_TEXT, { text: parsed.prompt });
	patchNodeInputs(graph, NODE_NEG_TEXT, {
		text: parsed.negativePrompt || NEGATIVE_PROMPT_DEFAULT,
	});
	patchNodeInputs(graph, NODE_LOAD_IMAGE, {
		image: buildInputImageFilename(requestId),
	});
}

function patchDimensions(
	graph: Record<string, ComfyUINodeApiInput>,
	dims: { height: number; width: number },
	length: number
): void {
	patchNodeInputs(graph, NODE_WAN_I2V, {
		height: dims.height,
		length,
		width: dims.width,
	});
}

function patchSamplers(
	graph: Record<string, ComfyUINodeApiInput>,
	parsed: WanVideoParsed,
	settings: ResolvedSettings
): void {
	const seed = parsed.seed ?? randomSeed();
	const steps = Math.max(1, parsed.steps);
	const boundary = Math.min(
		steps,
		Math.max(1, Math.round(steps * NOISE_BOUNDARY))
	);
	patchNodeInputs(graph, NODE_KSAMPLER_HIGH, {
		cfg: parsed.cfgScale,
		end_at_step: boundary,
		noise_seed: seed,
		sampler_name: settings.samplerName,
		scheduler: settings.scheduler,
		start_at_step: 0,
		steps,
	});
	patchNodeInputs(graph, NODE_KSAMPLER_LOW, {
		cfg: parsed.cfgScale,
		end_at_step: 10_000,
		noise_seed: seed,
		sampler_name: settings.samplerName,
		scheduler: settings.scheduler,
		start_at_step: boundary,
		steps,
	});
}

function patchFps(
	graph: Record<string, ComfyUINodeApiInput>,
	fps: number
): void {
	const vhs = graph[NODE_VHS_MP4];
	if (vhs?.inputs) {
		vhs.inputs.frame_rate = fps;
	}
}

/**
 * Вставляет LoRA-лоадеры в цепочки обоих экспертов. Порядок:
 *   UNETLoader → [accel LoRA] → [scenario LoRA] → ModelSamplingSD3.
 * Wan 2.2 требует применять LoRA независимо на high- и low-ветви, иначе
 * стилизация теряется на половине шагов.
 */
function resolveScenarioLoraFilenames(parsed: WanVideoParsed): {
	high?: string;
	low?: string;
} {
	if (parsed.loraHighFilename && parsed.loraLowFilename) {
		return {
			high: parsed.loraHighFilename,
			low: parsed.loraLowFilename,
		};
	}
	if (parsed.loraCivitaiModelId && parsed.loraCivitaiVersionId) {
		const legacy = `civitai-${parsed.loraCivitaiModelId}-${parsed.loraCivitaiVersionId}.safetensors`;
		return { high: legacy, low: legacy };
	}
	return {};
}

function applyLoraChains(
	graph: Record<string, ComfyUINodeApiInput>,
	parsed: WanVideoParsed,
	settings: ResolvedSettings
): void {
	const scenarioLoras = resolveScenarioLoraFilenames(parsed);
	applyLoraChainForExpert(graph, {
		accelFilename: settings.accelLoraHighFilename,
		accelLoraNodeId: NODE_ACCEL_LORA_HIGH,
		accelStrength: settings.accelLoraStrength,
		modelSamplingNodeId: NODE_MODEL_SAMPLING_HIGH,
		scenarioFilename: scenarioLoras.high,
		scenarioLoraNodeId: NODE_SCENARIO_LORA_HIGH,
		scenarioStrength: parsed.loraScale,
		unetNodeId: NODE_UNET_HIGH,
	});
	applyLoraChainForExpert(graph, {
		accelFilename: settings.accelLoraLowFilename,
		accelLoraNodeId: NODE_ACCEL_LORA_LOW,
		accelStrength: settings.accelLoraStrength,
		modelSamplingNodeId: NODE_MODEL_SAMPLING_LOW,
		scenarioFilename: scenarioLoras.low,
		scenarioLoraNodeId: NODE_SCENARIO_LORA_LOW,
		scenarioStrength: parsed.loraScale,
		unetNodeId: NODE_UNET_LOW,
	});
}

interface ApplyLoraChainArgs {
	accelFilename?: string;
	accelLoraNodeId: string;
	accelStrength: number;
	modelSamplingNodeId: string;
	scenarioFilename?: string;
	scenarioLoraNodeId: string;
	scenarioStrength: number;
	unetNodeId: string;
}

function applyLoraChainForExpert(
	graph: Record<string, ComfyUINodeApiInput>,
	args: ApplyLoraChainArgs
): void {
	let modelRef: [string, number] = [args.unetNodeId, 0];
	if (args.accelFilename) {
		graph[args.accelLoraNodeId] = buildLoraLoaderNode(
			modelRef,
			args.accelFilename,
			args.accelStrength,
			"Wan accel LoRA"
		);
		modelRef = [args.accelLoraNodeId, 0];
	}
	if (args.scenarioFilename) {
		graph[args.scenarioLoraNodeId] = buildLoraLoaderNode(
			modelRef,
			args.scenarioFilename,
			args.scenarioStrength,
			"Civitai LoRA"
		);
		modelRef = [args.scenarioLoraNodeId, 0];
	}
	const modelSampling = graph[args.modelSamplingNodeId];
	if (modelSampling?.inputs) {
		modelSampling.inputs.model = modelRef;
	}
}

function buildLoraLoaderNode(
	modelRef: [string, number],
	loraName: string,
	strength: number,
	title: string
): ComfyUINodeApiInput {
	return {
		_meta: { title },
		class_type: "LoraLoaderModelOnly",
		inputs: {
			lora_name: loraName,
			model: modelRef,
			strength_model: strength,
		},
	};
}

function ensureFallbackSaveImage(
	graph: Record<string, ComfyUINodeApiInput>
): void {
	if (graph[NODE_FALLBACK_SAVE_IMAGE] || !graph[NODE_VAE_DECODE]) {
		return;
	}
	graph[NODE_FALLBACK_SAVE_IMAGE] = {
		_meta: { title: "Fallback SaveImage" },
		class_type: "SaveImage",
		inputs: {
			filename_prefix: "wan-22-frames",
			images: [NODE_VAE_DECODE, 0],
		},
	};
}

function ensureFallbackSaveAnimatedWebp(
	graph: Record<string, ComfyUINodeApiInput>,
	fps: number
): void {
	if (graph[NODE_FALLBACK_SAVE_WEBP] || !graph[NODE_VAE_DECODE]) {
		return;
	}
	graph[NODE_FALLBACK_SAVE_WEBP] = {
		_meta: { title: "Fallback SaveAnimatedWEBP" },
		class_type: "SaveAnimatedWEBP",
		inputs: {
			filename_prefix: "wan-22-anim",
			fps,
			images: [NODE_VAE_DECODE, 0],
			lossless: false,
			method: "default",
			quality: 90,
		},
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

function parseServerlessOutput(raw: unknown): WanVideoOutput {
	const parsed = serverlessOutputSchema.parse(raw);
	if (parsed.errors && parsed.errors.length > 0) {
		throw new Error(
			`worker-comfyui returned errors: ${parsed.errors.join("; ")}`
		);
	}
	if (!parsed.images || parsed.images.length === 0) {
		throw new Error(
			"worker-comfyui returned no output images — workflow probably failed silently"
		);
	}
	const ranked = [...parsed.images]
		.map((item) => ({ item, rank: videoRank(item) }))
		.filter((entry) => entry.rank > 0)
		.sort((a, b) => b.rank - a.rank);
	const best = ranked[0]?.item;
	if (best) {
		const mime = guessVideoMime(best.filename);
		return {
			requestId: "",
			videoUrl:
				best.type === "s3_url" ? best.data : `data:${mime};base64,${best.data}`,
		};
	}
	const firstFilename = parsed.images[0]?.filename ?? "<no-filename>";
	throw new Error(
		`worker-comfyui returned only static image outputs (e.g. ${firstFilename}); ` +
			"SaveAnimatedWEBP/VHS_VideoCombine likely failed to register in this ComfyUI build"
	);
}

function videoRank(item: { data: string; filename?: string }): number {
	const filename = (item.filename ?? "").toLowerCase();
	if (
		filename.endsWith(".mp4") ||
		filename.endsWith(".mov") ||
		filename.endsWith(".mkv") ||
		item.data.startsWith("data:video/mp4")
	) {
		return 100;
	}
	if (filename.endsWith(".webm") || item.data.startsWith("data:video/webm")) {
		return 80;
	}
	if (filename.endsWith(".gif") || item.data.startsWith("data:image/gif")) {
		return 40;
	}
	if (filename.endsWith(".webp") || item.data.startsWith("data:image/webp")) {
		return 20;
	}
	return 0;
}

function guessVideoMime(filename?: string): string {
	if (!filename) {
		return "video/mp4";
	}
	const lower = filename.toLowerCase();
	if (lower.endsWith(".webp")) {
		return "image/webp";
	}
	if (lower.endsWith(".gif")) {
		return "image/gif";
	}
	if (lower.endsWith(".webm")) {
		return "video/webm";
	}
	if (lower.endsWith(".mov")) {
		return "video/quicktime";
	}
	if (lower.endsWith(".mkv")) {
		return "video/x-matroska";
	}
	return "video/mp4";
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
	const longest = Math.max(probed.width, probed.height);
	const scale = MAX_OUTPUT_EDGE_PX / longest;
	return {
		height: snapDimension(probed.height * scale),
		width: snapDimension(probed.width * scale),
	};
}

function snapDimension(value: number): number {
	const rounded =
		Math.round(value / DIM_ALIGNMENT) * DIM_ALIGNMENT || DIM_ALIGNMENT;
	return Math.max(MIN_OUTPUT_EDGE_PX, Math.min(MAX_OUTPUT_EDGE_PX, rounded));
}

/** Wan требует длину вида 4n+1; round-to-nearest и clamp. */
export function snapFrameCount(value: number): number {
	const safe = Number.isFinite(value) ? value : DEFAULT_FRAMES;
	const blocks = Math.max(0, Math.round((safe - 1) / FRAME_ALIGNMENT));
	const aligned = blocks * FRAME_ALIGNMENT + 1;
	return Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, aligned));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i += 1) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary);
}

export const WAN_22_I2V_NODE_IDS = {
	NODE_CLIP_LOADER,
	NODE_KSAMPLER_HIGH,
	NODE_KSAMPLER_LOW,
	NODE_LOAD_IMAGE,
	NODE_MODEL_SAMPLING_HIGH,
	NODE_MODEL_SAMPLING_LOW,
	NODE_NEG_TEXT,
	NODE_POS_TEXT,
	NODE_SCENARIO_LORA_HIGH,
	NODE_SCENARIO_LORA_LOW,
	NODE_UNET_HIGH,
	NODE_UNET_LOW,
	NODE_VAE_DECODE,
	NODE_VAE_LOADER,
	NODE_VHS_MP4,
	NODE_WAN_I2V,
} as const;
