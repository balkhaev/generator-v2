import { z } from "zod";
import FLUX_DEV_DETAILER_API_GRAPH from "../../templates/api/flux-dev-detailer.json" with {
	type: "json",
};
import type { ComfyUINodeApiInput } from "../comfyui/client";
import type {
	ServerlessPayloadContext,
	ServerlessWorkflow,
} from "../workflow/definition";

// Детейлер переиспользует тот же all-in-one fp8-чекпоинт Flux.1-dev, что и
// text-to-image workflow (тот же serverless endpoint, та же модель на network
// volume). Отличается граф: вместо EmptyLatent → img2img c апскейлом и
// низким denoise для добавления деталей.
const DEFAULT_CHECKPOINT = "flux1-dev-fp8.safetensors";

const DEFAULT_STEPS = 20;
const DEFAULT_GUIDANCE = 3.5;
// Низкий denoise сохраняет композицию исходника, добавляя детали/резкость.
const DEFAULT_DENOISE = 0.4;
const DEFAULT_UPSCALE_BY = 1.5;
const DEFAULT_POSITIVE_PROMPT =
	"highly detailed, sharp focus, intricate texture, high quality";

const MIN_DENOISE = 0.05;
const MAX_DENOISE = 1;
const MIN_UPSCALE_BY = 1;
const MAX_UPSCALE_BY = 2;
const FLUX_CFG = 1;
const RANDOM_SEED_BITS = 24;
const SERVERLESS_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;
const SERVERLESS_TTL_MS = 30 * 60 * 1000;

// Node ids см. templates/api/flux-dev-detailer.json.
const NODE_CHECKPOINT = "1";
const NODE_LOAD_IMAGE = "10";
const NODE_UPSCALE = "11";
const NODE_POS_TEXT = "20";
const NODE_NEG_TEXT = "21";
const NODE_FLUX_GUIDANCE = "22";
const NODE_KSAMPLER = "40";

const finiteNumber = z.coerce.number().finite();
const finiteInt = z.coerce.number().int().finite();

export const fluxDetailerInputSchema = z.object({
	prompt: z.string().default(""),
	negativePrompt: z.string().default(""),
	inputImageUrl: z.string().url(),
	denoise: finiteNumber.default(DEFAULT_DENOISE),
	upscaleBy: finiteNumber.default(DEFAULT_UPSCALE_BY),
	steps: finiteInt.default(DEFAULT_STEPS),
	guidance: finiteNumber.default(DEFAULT_GUIDANCE),
	seed: finiteInt.optional(),
});

export type FluxDetailerInput = z.input<typeof fluxDetailerInputSchema>;

export interface FluxDetailerOutput {
	imageUrl: string;
	imageUrls: string[];
	requestId: string;
}

export interface FluxDetailerServerlessWorkflowConfig {
	/** Имя all-in-one fp8-чекпоинта на volume (override DEFAULT_CHECKPOINT). */
	checkpointFilename?: string;
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

export function createFluxDevDetailerServerlessWorkflow(
	config: FluxDetailerServerlessWorkflowConfig
): ServerlessWorkflow<FluxDetailerInput, FluxDetailerOutput> {
	const settings: ResolvedSettings = {
		checkpointFilename: config.checkpointFilename ?? DEFAULT_CHECKPOINT,
		samplerName: config.samplerName ?? "euler",
		scheduler: config.scheduler ?? "simple",
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
			input: FluxDetailerInput,
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
		id: config.id ?? "flux-dev-detailer",
		inputSchema:
			fluxDetailerInputSchema as unknown as z.ZodType<FluxDetailerInput>,
		mode: "serverless",
		parseOutput(raw: unknown): FluxDetailerOutput {
			return parseServerlessOutput(raw);
		},
		webhookUrl: config.webhookUrl,
	};
}

interface BuildPayloadInternalArgs {
	fetchBytes: (url: string) => Promise<ArrayBuffer>;
	input: FluxDetailerInput;
	requestId: string;
	settings: ResolvedSettings;
}

async function buildPayloadInternal(
	args: BuildPayloadInternalArgs
): Promise<Record<string, unknown>> {
	const parsed = fluxDetailerInputSchema.parse(args.input);
	const imageBytes = await args.fetchBytes(parsed.inputImageUrl);
	const imageBase64 = arrayBufferToBase64(imageBytes);
	const filename = buildInputImageFilename(args.requestId);
	const graph = deepCloneJson(
		FLUX_DEV_DETAILER_API_GRAPH as unknown as Record<
			string,
			ComfyUINodeApiInput
		>
	);
	patchNodeInputs(graph, NODE_CHECKPOINT, {
		ckpt_name: args.settings.checkpointFilename,
	});
	patchNodeInputs(graph, NODE_LOAD_IMAGE, { image: filename });
	patchNodeInputs(graph, NODE_UPSCALE, {
		scale_by: clampUpscale(parsed.upscaleBy),
	});
	patchNodeInputs(graph, NODE_POS_TEXT, {
		text: parsed.prompt.trim() || DEFAULT_POSITIVE_PROMPT,
	});
	patchNodeInputs(graph, NODE_NEG_TEXT, { text: parsed.negativePrompt });
	patchNodeInputs(graph, NODE_FLUX_GUIDANCE, { guidance: parsed.guidance });
	patchNodeInputs(graph, NODE_KSAMPLER, {
		cfg: FLUX_CFG,
		denoise: clampDenoise(parsed.denoise),
		sampler_name: args.settings.samplerName,
		scheduler: args.settings.scheduler,
		seed: parsed.seed ?? randomSeed(),
		steps: Math.max(1, parsed.steps),
	});
	return {
		images: [
			{
				image: `data:image/png;base64,${imageBase64}`,
				name: filename,
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

function parseServerlessOutput(raw: unknown): FluxDetailerOutput {
	const parsed = serverlessOutputSchema.parse(raw);
	if (parsed.errors && parsed.errors.length > 0) {
		throw new Error(
			`worker-comfyui returned errors: ${parsed.errors.join("; ")}`
		);
	}
	if (!parsed.images || parsed.images.length === 0) {
		throw new Error(
			"worker-comfyui returned no output images — detailer workflow probably failed silently"
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

function buildInputImageFilename(requestId: string): string {
	const safe = requestId.replace(/[^a-zA-Z0-9_-]+/gu, "-");
	return `detailer-${safe}.png`;
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

function clampDenoise(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_DENOISE;
	}
	return Math.max(MIN_DENOISE, Math.min(MAX_DENOISE, value));
}

function clampUpscale(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_UPSCALE_BY;
	}
	return Math.max(MIN_UPSCALE_BY, Math.min(MAX_UPSCALE_BY, value));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i += 1) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary);
}

export const FLUX_DEV_DETAILER_NODE_IDS = {
	NODE_CHECKPOINT,
	NODE_FLUX_GUIDANCE,
	NODE_KSAMPLER,
	NODE_LOAD_IMAGE,
	NODE_NEG_TEXT,
	NODE_POS_TEXT,
	NODE_UPSCALE,
} as const;
