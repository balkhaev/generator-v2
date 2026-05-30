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

const DEFAULT_FALLBACK_WIDTH = 1280;
const DEFAULT_FALLBACK_HEIGHT = 736;
const DEFAULT_FRAMES = 121;
const DEFAULT_FPS = 24;
const DEFAULT_STEPS = 8;
const DEFAULT_CFG_SCALE = 1;
// Concept-LoRA поверх distill-LoRA (0.6) на силе 1.0 пересушивает анатомию
// и «плавит» лица. 0.7 сохраняет узнаваемость концепта без деградации лица.
const DEFAULT_LORA_SCALE = 0.7;
// Эталонные расписания сигм, экспортированные из живого шаблона
// (ноды 359 — первый pass, 360 — refine pass). Реальное число шагов задают
// ИМЕННО они (через ManualSigmas), а LTXVScheduler (206) в графе ни к чему
// не подключён. Поэтому `steps` мы транслируем в пересэмпленный по форме
// этой кривой список: при steps === нативного количества возвращаем эталон
// без изменений, иначе сгущаем/разрежаем, сохраняя форму распада.
const FIRST_PASS_SIGMAS_REF = [
	1.0, 0.993_75, 0.9875, 0.981_25, 0.975, 0.909_375, 0.725, 0.421_875, 0.0,
] as const;
const REFINE_PASS_SIGMAS_REF = [0.85, 0.725, 0.4219, 0.0] as const;
// Второй (refine) pass после ×2 spatial-апскейла. Distilled-модель обучена на
// ТОЧНОЕ stage-2 расписание из 4 сигм = 3 шага (см. официальный
// `LTX-2.3_T2V_I2V_Two_Stage_Distilled.json`, ManualSigmas id 4985:
// "0.85, 0.7250, 0.4219, 0.0"). Растягивание этого расписания
// интерполяцией ломает тренированную кривую и «плавит» детали, поэтому
// держим ровно 3 — реальное лечение «плывущих» лиц это включённый spatial
// upscale (enableSpatialUpscale), а не лишние refine-шаги.
const REFINE_PASS_STEPS = 3;
const SIGMA_ROUND = 1e6;
const COMPLETE_PROGRESS_THRESHOLD = 99.9;
const RANDOM_SEED_BITS = 24;
// LTX 2.3 spatial requirements + practical VRAM budget on the template GPU.
// Любая сторона должна делиться на 32; подбираем размеры от исходного фото
// и round-к-32 (nearest), чтобы не терять aspect ratio.
const DIM_ALIGNMENT = 32;
const MAX_OUTPUT_EDGE_PX = 1280;
const MIN_OUTPUT_EDGE_PX = 256;
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
const NODE_LTXV_SCHEDULER = "206"; // LTXVScheduler (disconnected — удаляем)
const NODE_SIGMAS_FIRST = "359"; // ManualSigmas (первый pass — реальные шаги)
const NODE_SIGMAS_REFINE = "360"; // ManualSigmas (refine pass)
const NODE_LOAD_IMAGE = "167"; // LoadImage
const NODE_LORA_LOADER = "366"; // Lora Loader (LoraManager)

export const ltx23InputSchema = z.object({
	prompt: z.string().min(1),
	negativePrompt: z.string().default(""),
	// width/height специально optional: если не заданы, выводим из самого
	// inputImage (snap-to-32, cap MAX_OUTPUT_EDGE_PX), сохраняя aspect ratio.
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
			const dims = await resolveOutputDimensions({
				explicitHeight: parsed.height,
				explicitWidth: parsed.width,
				fetchBytes,
				inputImageUrl: parsed.inputImageUrl,
			});
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
				value: Math.max(
					1,
					Math.ceil(parsed.numFrames / Math.max(1, parsed.fps))
				),
			});
			patchNodeInputs(graph, NODE_FPS, { value: parsed.fps });
			// `steps` управляет первым (основным) pass'ом через его ManualSigmas
			// (359), а не через disconnected LTXVScheduler (206). Refine pass
			// (360) держим на официальных REFINE_PASS_STEPS (stage-2 distilled).
			patchNodeInputs(graph, NODE_SIGMAS_FIRST, {
				sigmas: buildSigmaSchedule(FIRST_PASS_SIGMAS_REF, parsed.steps),
			});
			patchNodeInputs(graph, NODE_SIGMAS_REFINE, {
				sigmas: buildSigmaSchedule(REFINE_PASS_SIGMAS_REF, REFINE_PASS_STEPS),
			});
			delete graph[NODE_LTXV_SCHEDULER];
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
	let civitaiName: string | undefined;
	try {
		const info = await args.client.getCivitaiVersionInfo(
			"loras",
			args.modelVersionId
		);
		const file =
			info?.files?.find((f) => f.primary && f.name) ??
			info?.files?.find((f) => f.name);
		civitaiName = file?.name;
	} catch {
		civitaiName = undefined;
	}
	if (!civitaiName) {
		return;
	}
	// Lora Manager often saves Civitai LoRAs into category subfolders
	// (e.g. `LTXV 2.3/concept/SynthPussy_01_rank32.safetensors`).
	// ComfyUI validates `lora_name` against the exact entry in
	// `LoraLoaderModelOnly.lora_name` combo, so we resolve the bare
	// Civitai filename to the actual on-disk relative path by suffix
	// match against the live combo list.
	try {
		const info = await args.client.getObjectInfo("LoraLoaderModelOnly");
		const tuple = info?.input?.required?.lora_name;
		const list = readLoraNameOptions(tuple);
		if (list?.length) {
			const exact = list.find((entry) => entry === civitaiName);
			if (exact) {
				return exact;
			}
			const suffix = list.find(
				(entry) =>
					entry.endsWith(`/${civitaiName}`) ||
					entry.endsWith(`\\${civitaiName}`)
			);
			if (suffix) {
				return suffix;
			}
		}
	} catch {
		// fall through to civitaiName
	}
	return civitaiName;
}

function readLoraNameOptions(
	tuple: [unknown, Record<string, unknown>?] | undefined
): string[] | null {
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

/**
 * Пересэмплирует эталонную кривую сигм под `steps` шагов, сохраняя её форму.
 * Возвращает строку для `ManualSigmas.sigmas` (`"1.0, …, 0.0"`).
 *
 * - `steps + 1` точек на выходе (ManualSigmas трактует N сигм как N-1 шагов).
 * - При `steps + 1 === reference.length` отдаём эталон без изменений.
 * - Иначе — кусочно-линейная интерполяция по нормализованному индексу
 *   эталона: концы (1.0 и 0.0) сохраняются, монотонность не нарушается.
 */
export function buildSigmaSchedule(
	reference: readonly number[],
	steps: number
): string {
	const points = Math.max(1, Math.floor(steps)) + 1;
	if (points === reference.length) {
		return reference.join(", ");
	}
	const last = reference.length - 1;
	const out: number[] = [];
	for (let i = 0; i < points; i += 1) {
		const t = points === 1 ? 0 : i / (points - 1);
		const pos = t * last;
		const lo = Math.floor(pos);
		const hi = Math.min(last, Math.ceil(pos));
		const frac = pos - lo;
		const value =
			(reference[lo] as number) +
			((reference[hi] as number) - (reference[lo] as number)) * frac;
		out.push(Math.round(value * SIGMA_ROUND) / SIGMA_ROUND);
	}
	return out.join(", ");
}

export const LTX_23_SIGMA_REFS = {
	FIRST_PASS_SIGMAS_REF,
	REFINE_PASS_SIGMAS_REF,
	REFINE_PASS_STEPS,
} as const;

function randomSeed(): number {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const view = new DataView(bytes.buffer);
	return view.getUint32(0) % 2 ** RANDOM_SEED_BITS;
}

interface ResolveOutputDimensionsArgs {
	explicitHeight?: number;
	explicitWidth?: number;
	fetchBytes: (url: string) => Promise<ArrayBuffer>;
	inputImageUrl: string;
}

async function resolveOutputDimensions(
	args: ResolveOutputDimensionsArgs
): Promise<{ height: number; width: number }> {
	if (args.explicitWidth && args.explicitHeight) {
		return {
			height: snapDimension(args.explicitHeight),
			width: snapDimension(args.explicitWidth),
		};
	}
	let probed: ImageDimensions | null = null;
	try {
		const bytes = await args.fetchBytes(args.inputImageUrl);
		probed = probeImageDimensions(bytes);
	} catch {
		probed = null;
	}
	if (!probed) {
		return {
			height: snapDimension(args.explicitHeight ?? DEFAULT_FALLBACK_HEIGHT),
			width: snapDimension(args.explicitWidth ?? DEFAULT_FALLBACK_WIDTH),
		};
	}
	return deriveOutputDimensionsFromImage(probed);
}

/**
 * LTX 2.3 graph внутри (см. `templates/api/ltx-2-3-i2v-lvram.json`)
 * прогоняет картинку через ImageResizeKJv2 → ResizeImagesByLongerEdge=1536 →
 * latent upsampler ×2, поэтому если мы запрашиваем маленький dim
 * (например 704×864), output получается раздутым неоднородно по осям и
 * исходный aspect ratio теряется. Поэтому всегда нормализуем requested
 * dim до MAX_OUTPUT_EDGE_PX по длинной стороне с сохранением соотношения
 * сторон — графу всё равно нужно крутиться на больших латентах.
 */
export function deriveOutputDimensionsFromImage(source: ImageDimensions): {
	height: number;
	width: number;
} {
	const longest = Math.max(source.width, source.height);
	const scale = MAX_OUTPUT_EDGE_PX / longest;
	return {
		height: snapDimension(source.height * scale),
		width: snapDimension(source.width * scale),
	};
}

function snapDimension(value: number): number {
	const rounded =
		Math.round(value / DIM_ALIGNMENT) * DIM_ALIGNMENT || DIM_ALIGNMENT;
	return Math.max(MIN_OUTPUT_EDGE_PX, Math.min(MAX_OUTPUT_EDGE_PX, rounded));
}

export interface ImageDimensions {
	height: number;
	width: number;
}

const PNG_SIGNATURE_HEAD = 0x89_50_4e_47;
const PNG_SIGNATURE_TAIL = 0x0d_0a_1a_0a;
const JPEG_SOI = 0xff_d8;
const JPEG_MARKER_BYTE = 0xff;

/**
 * Лёгкий probe размеров для PNG и JPEG. WebP и AVIF пока не поддержаны —
 * для них вернётся null и `resolveOutputDimensions` уйдёт в fallback на
 * defaults. Studio-инпуты сейчас всегда JPG/PNG, поэтому достаточно.
 */
export function probeImageDimensions(
	buffer: ArrayBuffer
): ImageDimensions | null {
	if (buffer.byteLength < 8) {
		return null;
	}
	const view = new DataView(buffer);
	if (
		buffer.byteLength >= 24 &&
		view.getUint32(0) === PNG_SIGNATURE_HEAD &&
		view.getUint32(4) === PNG_SIGNATURE_TAIL
	) {
		return { height: view.getUint32(20), width: view.getUint32(16) };
	}
	if (view.getUint16(0) === JPEG_SOI && view.getUint8(2) === JPEG_MARKER_BYTE) {
		return readJpegDimensions(view);
	}
	return null;
}

function readJpegDimensions(view: DataView): ImageDimensions | null {
	let offset = 2;
	while (offset + 8 < view.byteLength) {
		if (view.getUint8(offset) !== JPEG_MARKER_BYTE) {
			return null;
		}
		const marker = view.getUint8(offset + 1);
		const segmentLength = view.getUint16(offset + 2);
		if (isJpegSofMarker(marker)) {
			return {
				height: view.getUint16(offset + 5),
				width: view.getUint16(offset + 7),
			};
		}
		offset += 2 + segmentLength;
	}
	return null;
}

function isJpegSofMarker(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
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
	NODE_SIGMAS_FIRST,
	NODE_SIGMAS_REFINE,
	NODE_WIDTH,
} as const;
