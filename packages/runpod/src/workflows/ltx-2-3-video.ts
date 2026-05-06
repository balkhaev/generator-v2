import { z } from "zod";
import LTX_23_I2V_API_GRAPH from "../../templates/api/ltx-2-3-i2v-lvram.json" with {
	type: "json",
};
import type { ComfyUIClient, ComfyUINodeApiInput } from "../comfyui/client";
import type {
	PodPrepareArgs,
	PodPrepareStatus,
	PodSpec,
	PodSubmitContext,
	PodSubmitResult,
	PodSuccessContext,
	PodWorkflow,
} from "../workflow/definition";

const finiteNumber = z.coerce.number().finite();
const finiteInt = z.coerce.number().int().finite();

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 736;
const DEFAULT_FRAMES = 121;
const DEFAULT_FPS = 24;
const DEFAULT_STEPS = 8;
const DEFAULT_CFG_SCALE = 1;
const DEFAULT_LORA_SCALE = 1;
const COMPLETE_PROGRESS_THRESHOLD = 99.9;
const RANDOM_SEED_BITS = 24;
const NEGATIVE_PROMPT_DEFAULT =
	"blurry, oversaturated, pixelated, low resolution, grainy, distorted, noise, compression artifacts, jpeg artifacts, glitches, watermark, text, logo, signature, copyright, subtitles, distorted sound, saturated sound, loud";

// Node ids inside templates/api/ltx-2-3-i2v-lvram.json — verified by exporting
// `app.graphToPrompt()` from the live ComfyUI WebUI inside the template pod.
const NODE_PROMPT = "352"; // PrimitiveStringMultiline (raw user prompt)
const NODE_NEG_TEXT = "110"; // CLIPTextEncode (negative)
const NODE_NOISE_FIRST = "115"; // RandomNoise (sampler 1)
const NODE_NOISE_SECOND = "114"; // RandomNoise (sampler 2)
const NODE_WIDTH = "292"; // INTConstant
const NODE_HEIGHT = "293"; // INTConstant
const NODE_LENGTH_SECONDS = "291"; // INTConstant
const NODE_FPS = "285"; // PrimitiveFloat
const NODE_LTXV_SCHEDULER = "206"; // LTXVScheduler.steps
const NODE_LOAD_IMAGE = "167"; // LoadImage
const NODE_LORA_LOADER = "366"; // Lora Loader (LoraManager)

export const ltx23InputSchema = z.object({
	prompt: z.string().min(1),
	negativePrompt: z.string().default(""),
	width: finiteInt.default(DEFAULT_WIDTH),
	height: finiteInt.default(DEFAULT_HEIGHT),
	numFrames: finiteInt.default(DEFAULT_FRAMES),
	fps: finiteInt.default(DEFAULT_FPS),
	steps: finiteInt.default(DEFAULT_STEPS),
	cfgScale: finiteNumber.default(DEFAULT_CFG_SCALE),
	seed: finiteInt.optional(),
	inputImageUrl: z.string().url(),
	loraCivitaiModelId: finiteInt.optional(),
	loraCivitaiVersionId: finiteInt.optional(),
	loraScale: finiteNumber.default(DEFAULT_LORA_SCALE),
});

export type Ltx23Input = z.input<typeof ltx23InputSchema>;
type Ltx23Parsed = z.output<typeof ltx23InputSchema>;

export interface Ltx23Output {
	podConsoleUrl: string;
	podId: string;
	requestId: string;
	videoUrl: string;
}

export interface Ltx23WorkflowConfig {
	id?: string;
	pod: PodSpec;
}

interface Ltx23PrepareDeps {
	fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}

/**
 * LTX 2.3 image-to-video workflow поверх RunPod template `p4f6rm9tb4`
 * (`ls250824/run-comfyui-ltx`). API graph экспортирован через
 * `app.graphToPrompt()` из живой ComfyUI WebUI и хранится в
 * `templates/api/ltx-2-3-i2v-lvram.json`. На каждом execute мы:
 *
 * 1. `prepare`: idempotently скачиваем нужную Civitai LoRA через Lora
 *    Manager API (фиксируем relative_path = `civitai-{modelId}-{versionId}.safetensors`),
 *    параллельно качаем bytes input image и аплоадим в pod через
 *    `/upload/image` под именем `req-{requestId}.png`.
 * 2. `buildPrompt`: deep-clone API graph и точечно патчим узлы — prompt /
 *    negative / seed / dims / frames / fps / steps / image / LoRA.
 *
 * Результат — MP4 в pod's `/output/`, который engine забирает через
 * `/view` и кладёт в наш S3.
 */
export function createLtx23VideoWorkflow(
	config: Ltx23WorkflowConfig,
	deps: Ltx23PrepareDeps = {}
): PodWorkflow<Ltx23Input, Ltx23Output> {
	const fetchBytes =
		deps.fetchBytes ??
		(async (url: string) => {
			const response = await globalThis.fetch(url);
			if (!response.ok) {
				throw new Error(
					`Failed to fetch input image (${response.status}): ${url}`
				);
			}
			return await response.arrayBuffer();
		});

	return {
		artifactContentType: "video/mp4",
		buildEnv() {
			return {};
		},
		buildPrompt(input: Ltx23Input, ctx: PodSubmitContext): PodSubmitResult {
			const parsed = ltx23InputSchema.parse(input);
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
			patchNodeInputs(graph, NODE_WIDTH, { value: parsed.width });
			patchNodeInputs(graph, NODE_HEIGHT, { value: parsed.height });
			patchNodeInputs(graph, NODE_LENGTH_SECONDS, {
				value: Math.max(
					1,
					Math.ceil(parsed.numFrames / Math.max(1, parsed.fps))
				),
			});
			patchNodeInputs(graph, NODE_FPS, { value: parsed.fps });
			patchNodeInputs(graph, NODE_LTXV_SCHEDULER, { steps: parsed.steps });
			patchNodeInputs(graph, NODE_LOAD_IMAGE, {
				image: buildInputImageFilename(ctx.requestId),
			});
			if (parsed.loraCivitaiModelId && parsed.loraCivitaiVersionId) {
				patchNodeInputs(graph, NODE_LORA_LOADER, {
					loras: {
						__value__: [
							{
								active: true,
								name: buildLoraFilename(
									parsed.loraCivitaiModelId,
									parsed.loraCivitaiVersionId
								),
								strength: parsed.loraScale,
							},
						],
					},
				});
			}
			return { prompt: graph };
		},
		id: config.id ?? "ltx-2-3-video",
		inputSchema: ltx23InputSchema as unknown as z.ZodType<Ltx23Input>,
		mode: "pod",
		parseOutput(ctx: PodSuccessContext): Ltx23Output {
			return {
				podConsoleUrl: ctx.runpodPodConsoleUrl,
				podId: ctx.podId,
				requestId: ctx.requestId,
				videoUrl: ctx.artifactPublicUrl,
			};
		},
		pod: { namePrefix: "ltx23", ...config.pod },
		prepare: (args: PodPrepareArgs<Ltx23Input>): Promise<PodPrepareStatus> =>
			prepareLtx23({ ...args, fetchBytes }),
	};
}

interface PrepareInternalArgs extends PodPrepareArgs<Ltx23Input> {
	fetchBytes: (url: string) => Promise<ArrayBuffer>;
}

async function prepareLtx23(
	args: PrepareInternalArgs
): Promise<PodPrepareStatus> {
	const parsed = ltx23InputSchema.parse(args.input);
	const imageStatus = await ensureInputImageUploaded({
		client: args.client,
		fetchBytes: args.fetchBytes,
		imageUrl: parsed.inputImageUrl,
		requestId: args.requestId,
	});
	if (imageStatus.errorSummary || !imageStatus.ready) {
		return imageStatus;
	}
	if (!(parsed.loraCivitaiModelId && parsed.loraCivitaiVersionId)) {
		return { ready: true };
	}
	return await ensureLoraDownloaded({
		client: args.client,
		downloadId: args.requestId,
		modelId: parsed.loraCivitaiModelId,
		modelVersionId: parsed.loraCivitaiVersionId,
	});
}

interface EnsureImageArgs {
	client: ComfyUIClient;
	fetchBytes: (url: string) => Promise<ArrayBuffer>;
	imageUrl: string;
	requestId: string;
}

async function ensureInputImageUploaded(
	args: EnsureImageArgs
): Promise<PodPrepareStatus> {
	try {
		const bytes = await args.fetchBytes(args.imageUrl);
		await args.client.uploadInputImage({
			bytes,
			filename: buildInputImageFilename(args.requestId),
			overwrite: true,
		});
		return { ready: true };
	} catch (error) {
		return {
			errorSummary: `Failed to upload input image: ${
				error instanceof Error ? error.message : String(error)
			}`,
			ready: false,
		};
	}
}

interface EnsureLoraArgs {
	client: ComfyUIClient;
	downloadId: string;
	modelId: number;
	modelVersionId: number;
}

async function ensureLoraDownloaded(
	args: EnsureLoraArgs
): Promise<PodPrepareStatus> {
	const relativePath = buildLoraFilename(args.modelId, args.modelVersionId);
	const progress = await args.client.pollLoraDownload(args.downloadId);
	if (progress.error) {
		return {
			errorSummary: `LoRA download failed: ${progress.error}`,
			ready: false,
		};
	}
	if (
		typeof progress.progress === "number" &&
		progress.progress >= COMPLETE_PROGRESS_THRESHOLD
	) {
		return { progressPct: 100, ready: true };
	}
	if (progress.status === "completed" || progress.status === "downloaded") {
		return { progressPct: 100, ready: true };
	}
	if (progress.status === "downloading") {
		return {
			progressPct: Math.round(progress.progress ?? 0),
			ready: false,
		};
	}
	if (typeof progress.progress === "number") {
		return {
			progressPct: Math.round(progress.progress),
			ready: false,
		};
	}
	try {
		await args.client.startLoraDownload({
			downloadId: args.downloadId,
			modelId: args.modelId,
			modelRoot: "loras",
			modelVersionId: args.modelVersionId,
			relativePath,
		});
	} catch (error) {
		return {
			errorSummary: `Failed to start LoRA download: ${
				error instanceof Error ? error.message : String(error)
			}`,
			ready: false,
		};
	}
	return { progressPct: 0, ready: false };
}

function buildInputImageFilename(requestId: string): string {
	const safe = requestId.replace(/[^a-zA-Z0-9_-]+/gu, "-");
	return `req-${safe}.png`;
}

function buildLoraFilename(modelId: number, modelVersionId: number): string {
	return `civitai-${modelId}-${modelVersionId}.safetensors`;
}

function patchNodeInputs(
	graph: Record<string, ComfyUINodeApiInput>,
	nodeId: string,
	patch: Record<string, unknown>
): void {
	const node = graph[nodeId];
	if (!node) {
		throw new Error(
			`LTX 2.3 API graph is missing node id ${nodeId}; template likely changed`
		);
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

export type Ltx23ParsedInput = Ltx23Parsed;
export const LTX_23_I2V_NODE_IDS = {
	NODE_FPS,
	NODE_HEIGHT,
	NODE_LENGTH_SECONDS,
	NODE_LOAD_IMAGE,
	NODE_LORA_LOADER,
	NODE_LTXV_SCHEDULER,
	NODE_NEG_TEXT,
	NODE_NOISE_FIRST,
	NODE_NOISE_SECOND,
	NODE_PROMPT,
	NODE_WIDTH,
} as const;
