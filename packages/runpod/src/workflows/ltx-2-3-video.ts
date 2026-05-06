import { z } from "zod";
import LTX_23_I2V_API_GRAPH from "../../templates/api/ltx-2-3-i2v-lvram.json" with {
	type: "json",
};
import type {
	ComfyUIClient,
	ComfyUINodeApiInput,
	ComfyUIObjectInfoEntry,
	LoraManagerLibrariesSnapshot,
} from "../comfyui/client";
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
		async buildPrompt(
			input: Ltx23Input,
			ctx: PodSubmitContext
		): Promise<PodSubmitResult> {
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
				const loraFilename = await resolveLoraFilename({
					client: ctx.client,
					downloadId: ctx.requestId,
					modelId: parsed.loraCivitaiModelId,
					modelVersionId: parsed.loraCivitaiVersionId,
				});
				if (!loraFilename) {
					throw new Error(
						`Failed to resolve Civitai LoRA filename for model ${parsed.loraCivitaiModelId} version ${parsed.loraCivitaiVersionId}`
					);
				}
				replaceLoraManagerWithStandardLoader(
					graph,
					NODE_LORA_LOADER,
					loraFilename,
					parsed.loraScale
				);
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
	const modelsStatus = await ensureModelsProvisioned(args.client);
	if (modelsStatus.errorSummary || !modelsStatus.ready) {
		return modelsStatus;
	}
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
		civitaiApiKey: args.civitaiApiKey,
		client: args.client,
		downloadId: args.requestId,
		modelId: parsed.loraCivitaiModelId,
		modelVersionId: parsed.loraCivitaiVersionId,
	});
}

/**
 * Pre-flight: убедиться, что HF-провижининг pod template уже докачал
 * все нужные нам файлы (LTX 2.3 transformer, VAE, gemma text encoder,
 * spatial upscaler, distilled LoRA) до того как мы сабмитим /prompt.
 *
 * Без этой проверки `submitPromptIfNeeded` уходит в /prompt пока списки
 * `loras/`, `vae/`, `text_encoders/`, `diffusion_models/` ещё пустые
 * (ComfyUI стартует за ~1 минуту, а провижининг 40+ GB длится ~5–10 минут),
 * и ComfyUI отвечает 400 `prompt_outputs_failed_validation`
 * "Value not in list" по каждому загрузчику.
 */
const REQUIRED_FILES: Array<{ file: string; input: string; node: string }> = [
	{
		file: "diffusion_models/ltx-2.3-22b-dev_transformer_only_bf16.safetensors",
		input: "unet_name",
		node: "UNETLoader",
	},
	{
		file: "loras/ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
		input: "lora_name",
		node: "LoraLoaderModelOnly",
	},
	{
		file: "vae/LTX23_video_vae_bf16.safetensors",
		input: "vae_name",
		node: "VAELoader",
	},
	{
		file: "vae/LTX23_audio_vae_bf16.safetensors",
		input: "vae_name",
		node: "VAELoaderKJ",
	},
	{
		file: "vae/taeltx2_3.safetensors",
		input: "vae_name",
		node: "VAELoader",
	},
	{
		file: "comfyui/gemma-3-12b-it-heretic-v2.safetensors",
		input: "clip_name1",
		node: "DualCLIPLoader",
	},
	{
		file: "text_encoders/ltx-2.3_text_projection_bf16.safetensors",
		input: "clip_name2",
		node: "DualCLIPLoader",
	},
	{
		file: "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
		input: "model_name",
		node: "LatentUpscaleModelLoader",
	},
];

async function ensureModelsProvisioned(
	client: ComfyUIClient
): Promise<PodPrepareStatus> {
	let satisfied = 0;
	const total = REQUIRED_FILES.length;
	const missing: string[] = [];
	for (const requirement of REQUIRED_FILES) {
		try {
			const info = await client.getObjectInfo(requirement.node);
			const list = readComfyComboValues(info, requirement.input);
			if (list?.includes(requirement.file)) {
				satisfied += 1;
			} else {
				missing.push(requirement.file);
			}
		} catch {
			missing.push(requirement.file);
		}
	}
	if (missing.length === 0) {
		return { progressPct: 100, ready: true };
	}
	const progressPct = Math.round((satisfied / total) * 100);
	return {
		progressPct,
		ready: false,
	};
}

function readComfyComboValues(
	info: ComfyUIObjectInfoEntry | null,
	inputName: string
): string[] | null {
	if (!info) {
		return null;
	}
	const required = info.input?.required?.[inputName];
	const optional = info.input?.optional?.[inputName];
	const tuple = required ?? optional;
	if (!tuple) {
		return null;
	}
	const head = tuple[0];
	if (Array.isArray(head)) {
		return head.filter((entry): entry is string => typeof entry === "string");
	}
	if (head === "COMBO" && tuple[1] && typeof tuple[1] === "object") {
		const options = (tuple[1] as { options?: unknown }).options;
		if (Array.isArray(options)) {
			return options.filter(
				(entry): entry is string => typeof entry === "string"
			);
		}
	}
	return null;
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
	civitaiApiKey?: string;
	client: ComfyUIClient;
	downloadId: string;
	modelId: number;
	modelVersionId: number;
}

async function ensureLoraDownloaded(
	args: EnsureLoraArgs
): Promise<PodPrepareStatus> {
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
		await ensureLoraManagerBootstrapped(args.client, args.civitaiApiKey);
		await args.client.startLoraDownload({
			downloadId: args.downloadId,
			modelId: args.modelId,
			modelVersionId: args.modelVersionId,
			useDefaultPaths: true,
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

/**
 * Lora Manager на свежем RunPod template требует две настройки, которые
 * по умолчанию пустые:
 *
 * - `default_lora_root` — куда сохранять скачанную LoRA. Без него
 *   `/api/lm/download-model use_default_paths=true` валится 500
 *   "Default lora root path not set in settings".
 * - `civitai_api_key` — токен для Civitai. Без него Civitai API возвращает
 *   401/403 и Lora Manager отдаёт 500 "Download failed with status 500"
 *   уже из downloader.py. Lora Manager при старте читает env var
 *   `CIVITAI_API_KEY`, но если она пуста или процесс уже запустился до
 *   подъёма env, мы перебиваем настройку явно.
 *
 * Идемпотентно: проверяем что уже стоит, и пишем недостающее.
 */
async function ensureLoraManagerBootstrapped(
	client: ComfyUIClient,
	civitaiApiKey?: string
): Promise<void> {
	const settings = await client.getLoraManagerSettings();
	const patch: Record<string, unknown> = {};
	if (
		typeof settings.default_lora_root !== "string" ||
		settings.default_lora_root.trim().length === 0
	) {
		const libraries = await client.getLoraManagerLibraries();
		const candidate = pickLorasRoot(libraries);
		if (!candidate) {
			throw new Error(
				"ComfyUI Lora Manager has no configured loras folder paths; cannot infer default_lora_root"
			);
		}
		patch.default_lora_root = candidate;
	}
	const existingApiKey = settings.civitai_api_key;
	if (
		civitaiApiKey &&
		(typeof existingApiKey !== "string" ||
			existingApiKey.trim().length === 0 ||
			existingApiKey !== civitaiApiKey)
	) {
		patch.civitai_api_key = civitaiApiKey;
	}
	if (Object.keys(patch).length > 0) {
		await client.updateLoraManagerSettings(patch);
	}
}

function pickLorasRoot(snapshot: LoraManagerLibrariesSnapshot): string | null {
	const libs = snapshot.libraries ?? {};
	const active = snapshot.active_library;
	const order = active ? [active, ...Object.keys(libs)] : Object.keys(libs);
	for (const name of order) {
		const lib = libs[name];
		if (
			typeof lib?.default_lora_root === "string" &&
			lib.default_lora_root.trim().length > 0
		) {
			return lib.default_lora_root;
		}
		const folder = lib?.folder_paths?.loras;
		if (Array.isArray(folder) && folder.length > 0) {
			const first = folder.find(
				(p) => typeof p === "string" && p.trim().length > 0
			);
			if (first) {
				return first;
			}
		}
	}
	return null;
}

async function resolveLoraFilename(
	args: EnsureLoraArgs
): Promise<string | undefined> {
	try {
		const info = await args.client.getCivitaiVersionInfo(
			"loras",
			args.modelVersionId
		);
		const file =
			info?.files?.find((f) => f.primary && f.name) ??
			info?.files?.find((f) => f.name);
		return file?.name;
	} catch {
		return undefined;
	}
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
		throw new Error(
			`LTX 2.3 API graph is missing node id ${nodeId}; template likely changed`
		);
	}
	node.inputs = { ...node.inputs, ...patch };
}

/**
 * Заменяет `Lora Loader (LoraManager)`-ноду на стандартную ComfyUI
 * `LoraLoaderModelOnly` с тем же id. LoraManager-кастом-ноду мы используем
 * только как «слот» в шаблоне: на ней нестабильная сериализация и runtime
 * легко падает на пустых полях. Стандартная LoraLoaderModelOnly работает
 * на любом ComfyUI и понимает `lora_name` относительно `models/loras/`.
 */
function replaceLoraManagerWithStandardLoader(
	graph: Record<string, ComfyUINodeApiInput>,
	nodeId: string,
	loraFilename: string,
	strength: number
): void {
	const node = graph[nodeId];
	if (!node) {
		throw new Error(
			`LTX 2.3 API graph is missing node id ${nodeId}; template likely changed`
		);
	}
	const modelInput = node.inputs?.model;
	if (!Array.isArray(modelInput)) {
		throw new Error(
			`LTX 2.3 API graph node ${nodeId} has no model input; template likely changed`
		);
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
