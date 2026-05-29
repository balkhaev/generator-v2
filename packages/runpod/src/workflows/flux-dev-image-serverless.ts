import { z } from "zod";
import FLUX_DEV_T2I_API_GRAPH from "../../templates/api/flux-dev-t2i.json" with {
	type: "json",
};
import type { ComfyUINodeApiInput } from "../comfyui/client";
import type { ServerlessWorkflow } from "../workflow/definition";

// Имя all-in-one fp8-чекпоинта внутри `/runpod-volume/ComfyUI/models/checkpoints/`.
// Comfy-Org repackaged Flux.1-dev включает diffusion model + clip_l + t5xxl +
// vae в одном файле, грузится через CheckpointLoaderSimple. Override —
// через config/env без редеплоя worker-образа (модель живёт на network volume).
const DEFAULT_CHECKPOINT = "flux1-dev-fp8.safetensors";

const DEFAULT_WIDTH = 896;
const DEFAULT_HEIGHT = 1152;
const DEFAULT_STEPS = 28;
// Flux dev guidance distilled — рабочий диапазон 2.5–4.0; 3.5 рекомендуемый.
const DEFAULT_GUIDANCE = 3.5;
const DEFAULT_LORA_SCALE = 1;
const DEFAULT_BATCH = 1;
// Flux uses guidance-distilled CFG=1 (настоящий guidance — через FluxGuidance).
const FLUX_CFG = 1;

// Flux latent: /8 downscale + 2×2 patchify ⇒ обе оси должны быть кратны 16.
const DIM_ALIGNMENT = 16;
const MAX_EDGE_PX = 1536;
const MIN_EDGE_PX = 256;
const MAX_BATCH = 4;
const RANDOM_SEED_BITS = 24;
const SERVERLESS_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;
const SERVERLESS_TTL_MS = 30 * 60 * 1000;
const WARMUP_EXECUTION_TIMEOUT_MS = 4 * 60 * 1000;
const WARMUP_TTL_MS = 15 * 60 * 1000;

// Node ids см. templates/api/flux-dev-t2i.json.
const NODE_CHECKPOINT = "1";
const NODE_POS_TEXT = "20";
const NODE_NEG_TEXT = "21";
const NODE_FLUX_GUIDANCE = "22";
const NODE_EMPTY_LATENT = "30";
const NODE_KSAMPLER = "40";
// Injected LoRA loader (зарезервированный диапазон > 9000).
const NODE_SCENARIO_LORA = "9101";

const finiteNumber = z.coerce.number().finite();
const finiteInt = z.coerce.number().int().finite();

export const fluxImageInputSchema = z.object({
	prompt: z.string().min(1),
	negativePrompt: z.string().default(""),
	width: finiteInt.default(DEFAULT_WIDTH),
	height: finiteInt.default(DEFAULT_HEIGHT),
	steps: finiteInt.default(DEFAULT_STEPS),
	guidance: finiteNumber.default(DEFAULT_GUIDANCE),
	numImages: finiteInt.default(DEFAULT_BATCH),
	seed: finiteInt.optional(),
	/** Pre-provisioned LoRA filename under `models/loras/`. */
	loraFilename: z.string().min(1).optional(),
	loraScale: finiteNumber.default(DEFAULT_LORA_SCALE),
});

export type FluxImageInput = z.input<typeof fluxImageInputSchema>;
type FluxImageParsed = z.output<typeof fluxImageInputSchema>;

export interface FluxImageOutput {
	imageUrl: string;
	imageUrls: string[];
	requestId: string;
}

export interface FluxImageServerlessWorkflowConfig {
	/** Имя all-in-one fp8-чекпоинта на volume (override DEFAULT_CHECKPOINT). */
	checkpointFilename?: string;
	enableWarmup?: boolean;
	endpointId: string;
	id?: string;
	/** sampler/scheduler для KSampler. */
	samplerName?: string;
	scheduler?: string;
	webhookUrl?: string;
}

interface ResolvedSettings {
	checkpointFilename: string;
	samplerName: string;
	scheduler: string;
}

export function createFluxDevImageServerlessWorkflow(
	config: FluxImageServerlessWorkflowConfig
): ServerlessWorkflow<FluxImageInput, FluxImageOutput> {
	const enableWarmup = config.enableWarmup ?? false;
	const settings: ResolvedSettings = {
		checkpointFilename: config.checkpointFilename ?? DEFAULT_CHECKPOINT,
		samplerName: config.samplerName ?? "euler",
		scheduler: config.scheduler ?? "simple",
	};
	return {
		buildPayload(input: FluxImageInput): Record<string, unknown> {
			return buildPayloadInternal(input, settings);
		},
		defaultPolicy: {
			executionTimeout: SERVERLESS_EXECUTION_TIMEOUT_MS,
			ttl: SERVERLESS_TTL_MS,
		},
		endpointId: config.endpointId,
		id: config.id ?? "flux-dev-image",
		inputSchema: fluxImageInputSchema as unknown as z.ZodType<FluxImageInput>,
		mode: "serverless",
		parseOutput(raw: unknown): FluxImageOutput {
			return parseServerlessOutput(raw);
		},
		warmup: enableWarmup
			? {
					buildInput() {
						return {
							guidance: 1,
							height: 256,
							numImages: 1,
							prompt: "warmup",
							steps: 1,
							width: 256,
						} satisfies FluxImageInput;
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

function buildPayloadInternal(
	input: FluxImageInput,
	settings: ResolvedSettings
): Record<string, unknown> {
	const parsed = fluxImageInputSchema.parse(input);
	const graph = deepCloneJson(
		FLUX_DEV_T2I_API_GRAPH as unknown as Record<string, ComfyUINodeApiInput>
	);
	patchNodeInputs(graph, NODE_CHECKPOINT, {
		ckpt_name: settings.checkpointFilename,
	});
	patchNodeInputs(graph, NODE_POS_TEXT, { text: parsed.prompt });
	patchNodeInputs(graph, NODE_NEG_TEXT, { text: parsed.negativePrompt });
	patchNodeInputs(graph, NODE_FLUX_GUIDANCE, { guidance: parsed.guidance });
	patchNodeInputs(graph, NODE_EMPTY_LATENT, {
		batch_size: clampBatch(parsed.numImages),
		height: snapDimension(parsed.height),
		width: snapDimension(parsed.width),
	});
	patchNodeInputs(graph, NODE_KSAMPLER, {
		cfg: FLUX_CFG,
		sampler_name: settings.samplerName,
		scheduler: settings.scheduler,
		seed: parsed.seed ?? randomSeed(),
		steps: Math.max(1, parsed.steps),
	});
	applyLoraChain(graph, parsed);
	return { workflow: graph };
}

/**
 * Вставляет LoRA-лоадер между чекпоинтом и потребителями MODEL/CLIP:
 *   CheckpointLoaderSimple → LoraLoader → (CLIPTextEncode×2 / KSampler).
 * Flux LoRA применяется и на model, и на clip.
 */
function applyLoraChain(
	graph: Record<string, ComfyUINodeApiInput>,
	parsed: FluxImageParsed
): void {
	if (!parsed.loraFilename) {
		return;
	}
	graph[NODE_SCENARIO_LORA] = {
		_meta: { title: "LoRA" },
		class_type: "LoraLoader",
		inputs: {
			clip: [NODE_CHECKPOINT, 1],
			lora_name: parsed.loraFilename,
			model: [NODE_CHECKPOINT, 0],
			strength_clip: parsed.loraScale,
			strength_model: parsed.loraScale,
		},
	};
	repointInput(graph, NODE_KSAMPLER, "model", [NODE_SCENARIO_LORA, 0]);
	repointInput(graph, NODE_POS_TEXT, "clip", [NODE_SCENARIO_LORA, 1]);
	repointInput(graph, NODE_NEG_TEXT, "clip", [NODE_SCENARIO_LORA, 1]);
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

function parseServerlessOutput(raw: unknown): FluxImageOutput {
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
		.map((item) => ({ item, rank: imageRank(item) }))
		.filter((entry) => entry.rank > 0)
		.sort((a, b) => b.rank - a.rank);
	const urls = ranked.map((entry) => toImageUrl(entry.item));
	if (urls.length === 0) {
		const firstFilename = parsed.images[0]?.filename ?? "<no-filename>";
		throw new Error(
			`worker-comfyui returned no usable still-image outputs (e.g. ${firstFilename})`
		);
	}
	return {
		imageUrl: urls[0] as string,
		imageUrls: urls,
		requestId: "",
	};
}

function toImageUrl(item: { data: string; filename?: string; type?: string }) {
	if (item.type === "s3_url") {
		return item.data;
	}
	return `data:${guessImageMime(item.filename)};base64,${item.data}`;
}

function imageRank(item: { data: string; filename?: string }): number {
	const filename = (item.filename ?? "").toLowerCase();
	if (filename.endsWith(".png") || item.data.startsWith("data:image/png")) {
		return 100;
	}
	if (
		filename.endsWith(".jpg") ||
		filename.endsWith(".jpeg") ||
		item.data.startsWith("data:image/jpeg")
	) {
		return 80;
	}
	if (filename.endsWith(".webp") || item.data.startsWith("data:image/webp")) {
		return 60;
	}
	// Worker may return base64 без filename — считаем картинкой по умолчанию.
	if (!(filename || item.data.startsWith("data:"))) {
		return 40;
	}
	return 0;
}

function guessImageMime(filename?: string): string {
	if (!filename) {
		return "image/png";
	}
	const lower = filename.toLowerCase();
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (lower.endsWith(".webp")) {
		return "image/webp";
	}
	return "image/png";
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

function repointInput(
	graph: Record<string, ComfyUINodeApiInput>,
	nodeId: string,
	key: string,
	ref: [string, number]
): void {
	const node = graph[nodeId];
	if (node?.inputs) {
		node.inputs[key] = ref;
	}
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

function snapDimension(value: number): number {
	const rounded =
		Math.round(value / DIM_ALIGNMENT) * DIM_ALIGNMENT || DIM_ALIGNMENT;
	return Math.max(MIN_EDGE_PX, Math.min(MAX_EDGE_PX, rounded));
}

function clampBatch(value: number): number {
	const safe = Number.isFinite(value) ? Math.round(value) : DEFAULT_BATCH;
	return Math.max(1, Math.min(MAX_BATCH, safe));
}

export const FLUX_DEV_T2I_NODE_IDS = {
	NODE_CHECKPOINT,
	NODE_EMPTY_LATENT,
	NODE_FLUX_GUIDANCE,
	NODE_KSAMPLER,
	NODE_NEG_TEXT,
	NODE_POS_TEXT,
	NODE_SCENARIO_LORA,
} as const;
