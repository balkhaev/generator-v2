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
/** Trusted S3 sample — тот же URL, что в smoke-ltx-serverless.ts. */
const WARMUP_INPUT_IMAGE_URL =
	"https://hel1.your-objectstorage.com/generator/studio-inputs/smoke/sample.png";
const WARMUP_FRAMES = 17;
const WARMUP_EXECUTION_TIMEOUT_MS = 12 * 60 * 1000;
const WARMUP_TTL_MS = 15 * 60 * 1000;
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
// VAEDecode → IMAGE батч из всех кадров. На этот же узел смотрит и
// VHS_VideoCombine (mp4), и наш fallback SaveImage (PNG frames).
const NODE_VAE_DECODE_IMAGES = "364";
// Цепочка второго (upscale) pass'а: 161 → 109 → 113 → 116 → 118 (upscaler) →
// 160 → 117 → 119 → 125 → 364. Spatial upscaler требует модели
// `ltx-2.3-spatial-upscaler-x2-1.1.safetensors`, которой пока нет на network
// volume (см. TODO: seed upscaler model). До тех пор мы обходим второй pass
// и подаём samples первого pass'а напрямую в VAEDecode.
const NODE_FIRST_PASS_SEPARATE_AV = "116";
const NODE_LATENT_UPSCALER = "118";
const NODE_LATENT_UPSCALER_MODEL_LOADER = "189";
const NODE_SECOND_PASS_IMG2VIDEO = "160";
const NODE_SECOND_PASS_CONCAT_AV = "117";
const NODE_SECOND_PASS_SAMPLER = "119";
const NODE_SECOND_PASS_SEPARATE_AV = "125";
const NODE_SECOND_PASS_AUDIO_VAE = "201";
// Audio chain: 196 (VAELoaderKJ для audio VAE), 199 (EmptyLatentAudio),
// 201 (AudioVAEDecode), 109/117 (ConcatAVLatent — соединяет video и audio
// latents). В текущем worker'е VAELoaderKJ падает с "VAE is invalid: None"
// (audio-vae файл отсутствует/несовместим). Для базовой генерации mp4 без
// звука audio-ветка не нужна — bypass'ем её: ConcatAVLatent будет получать
// audio_latent == video_latent (пустой пасс-thru хак), audio VAE+EmptyAudio
// удаляются.
const NODE_AUDIO_VAE_LOADER = "196";
// Уникальный id для injected стокового SaveImage. Берём заведомо свободный
// диапазон (> 1000), чтобы гарантированно не конфликтовать с ручными правками
// LVRAM-шаблона.
const NODE_FALLBACK_SAVE_IMAGE = "9001";
// Дополнительный fallback — стоковый `SaveAnimatedWEBP` (built-in ComfyUI).
// Worker-comfyui handler.py читает output key `images`, в которое
// SaveAnimatedWEBP пишет анимированный webp. VHS_VideoCombine пишет в
// `gifs`/`videos` — наш завендоренный handler.py их обрабатывает.
// Webp оставляем как safety net на случай, если custom-нода VHS упадёт.
const NODE_FALLBACK_SAVE_WEBP = "9002";
// VHS_VideoCombine (comfyui-videohelpersuite) — даёт реальный h264 mp4.
// Наш handler.py в worker-image поднимает output key `gifs` (туда VHS
// публикует mp4-файлы); базовый upstream-handler этот ключ игнорирует.
// Используем уже существующий в LVRAM-шаблоне узел 140 (VHS_VideoCombine),
// но: (1) принудительно отвязываем audio input (исходный 201 удалён
// bypassSpatialUpscale, без audio mp4 пишется только с видео-треком),
// (2) переключаем images-source на NODE_VAE_DECODE_IMAGES (на случай
// если шаблон обновится и индекс собьётся), (3) ставим pix_fmt yuv420p
// для Safari/iOS-совместимости и crf=19 (визуально lossless для
// постпродакшна, файл ~1-3MB на 5-секундное 720p).
const NODE_VHS_MP4 = "140";
// positive CLIPTextEncode (узел 121) в исходном шаблоне берёт text от
// `TextGenerateLTX2Prompt` (349) — LLM-обогатителя. Этот узел требует
// отдельной LLM (Qwen) внутри ComfyUI, которая (а) грузится 60-180с при
// первом вызове и (б) может зависнуть при отсутствии модели на network
// volume. Без неё positive ветка ломается → CFGGuider → KSampler → VAEDecode
// не выполняются → handler возвращает `success_no_images`.
// Поэтому в serverless mode мы bypass'аем 349 и заставляем 121 брать text
// напрямую из raw user prompt (352).
const NODE_POSITIVE_CLIP_ENCODE = "121";
const NODE_TEXT_GENERATE_LTX2 = "349";
const NODE_PROMPT_INSTRUCT_PRIMITIVE = "350";
const NODE_PROMPT_CONCATENATE = "347";
// PreviewAny — единственный output node, который успешно выполнялся в
// сломанном графе (он не зависит от модели). После bypass его роль
// диагностическая → можем удалить, чтобы worker-comfyui handler сразу
// видел только реальные image-outputs.
const NODE_PREVIEW_ANY = "361";

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
	/**
	 * Периодический warm-up ping через `createServerlessWarmupRunner`.
	 * Основной путь без cold start — `workersMin ≥ 1` на endpoint'е; warmup
	 * подстраховывает, если idle worker умер (crash / redeploy image).
	 */
	enableWarmup?: boolean;
	endpointId: string;
	id?: string;
	webhookUrl?: string;
}

export function createLtx23VideoServerlessWorkflow(
	config: Ltx23ServerlessWorkflowConfig
): ServerlessWorkflow<Ltx23Input, Ltx23Output> {
	const enableWarmup = config.enableWarmup ?? false;
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
		warmup: enableWarmup
			? {
					buildInput() {
						return {
							cfgScale: 1,
							fps: 8,
							height: 512,
							inputImageUrl: WARMUP_INPUT_IMAGE_URL,
							negativePrompt: "",
							numFrames: WARMUP_FRAMES,
							prompt: "warmup",
							steps: 1,
							width: 512,
						} satisfies Ltx23Input;
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
	// Узел `366 — Lora Loader (LoraManager)` принадлежит custom node
	// `willmiao/ComfyUI-Lora-Manager`, который НЕ установлен в нашем
	// `worker-ltx-comfyui` image. Если оставить его как есть, ComfyUI отрежет
	// узел при валидации (как unknown class) → вся цепочка LoRA → KSampler →
	// VAEDecode → VHS_VideoCombine отвалится → ответ `prompt_no_outputs`.
	// Поэтому всегда переписываем 366: либо подставляем стандартный
	// `LoraLoaderModelOnly` с civitai LoRA, либо удаляем узел и
	// перенаправляем его consumers напрямую на distill LoRA (`134`).
	if (parsed.loraCivitaiModelId && parsed.loraCivitaiVersionId) {
		const filename = `civitai-${parsed.loraCivitaiModelId}-${parsed.loraCivitaiVersionId}.safetensors`;
		replaceLoraManagerWithStandardLoader(
			graph,
			NODE_LORA_LOADER,
			filename,
			parsed.loraScale
		);
	} else {
		bypassLoraManagerNode(graph, NODE_LORA_LOADER);
	}
	// Bypass LLM-обогатителя prompt'а: positive CLIPTextEncode (121) должен
	// брать text напрямую из `352` (raw user prompt), а не из 349
	// (TextGenerateLTX2Prompt). См. подробности в комментариях к
	// NODE_POSITIVE_CLIP_ENCODE / NODE_TEXT_GENERATE_LTX2 выше.
	bypassTextGenerateLtx2Prompt(graph);
	// Bypass второго (spatial upscale) pass'а — нужная модель отсутствует
	// на network volume. VAEDecode переключаем на output первого sampler'а.
	bypassSpatialUpscale(graph);
	// Bypass audio VAE: для генерации видео без звука audio chain не нужен,
	// а соответствующий VAE отсутствует/несовместим в текущем worker'е.
	bypassAudioBranch(graph);
	// Fallback output nodes. Если custom `VHS_VideoCombine` не работает (а
	// он почти гарантированно не работает в текущем runpod-workers/worker-comfyui
	// 5.8.5 handler.py — тот читает только output key `images`, а VHS пишет в
	// `gifs`/`videos`), оба этих стоковых узла обеспечат получение артефактов:
	//   - SaveAnimatedWEBP даст один анимированный webp файл с reall видео
	//     (handler.py его подхватит как s3_url image)
	//   - SaveImage даст N png-frames на случай, если webp encoder упадёт.
	ensureFallbackSaveImage(graph);
	ensureFallbackSaveAnimatedWebp(graph, parsed.fps);
	repairVhsMp4(graph, parsed.fps);
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
	if (!parsed.images || parsed.images.length === 0) {
		throw new Error(
			"worker-comfyui returned no output images — workflow probably failed silently"
		);
	}
	// Приоритет вывода (см. ensureFallback* функции):
	//   1) mp4 / webm / mov / mkv от VHS_VideoCombine (preferred — реальный
	//      h264 видеоконтейнер с правильным fps, плеер-агностик)
	//   2) gif от VHS — fallback на legacy формат
	//   3) webp от SaveAnimatedWEBP — анимированное изображение, играет
	//      во всех современных плеерах но без частоты кадров в headers
	//   4) png-frame от SaveImage — деградированный режим, отдаём как
	//      ошибку т.к. UI ожидает video stream.
	const ranked = [...parsed.images]
		.map((item) => ({ item, rank: videoRank(item) }))
		.filter((entry) => entry.rank > 0)
		.sort((a, b) => b.rank - a.rank);
	const best = ranked[0]?.item;
	if (best) {
		const mime = guessVideoMime(best.filename);
		return {
			podConsoleUrl: "",
			podId: "",
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

function ensureFallbackSaveImage(
	graph: Record<string, ComfyUINodeApiInput>
): void {
	if (graph[NODE_FALLBACK_SAVE_IMAGE]) {
		return;
	}
	if (!graph[NODE_VAE_DECODE_IMAGES]) {
		return;
	}
	graph[NODE_FALLBACK_SAVE_IMAGE] = {
		_meta: { title: "Fallback SaveImage" },
		class_type: "SaveImage",
		inputs: {
			filename_prefix: "ltx-23-frames",
			images: [NODE_VAE_DECODE_IMAGES, 0],
		},
	};
}

function ensureFallbackSaveAnimatedWebp(
	graph: Record<string, ComfyUINodeApiInput>,
	fps: number
): void {
	if (graph[NODE_FALLBACK_SAVE_WEBP]) {
		return;
	}
	if (!graph[NODE_VAE_DECODE_IMAGES]) {
		return;
	}
	graph[NODE_FALLBACK_SAVE_WEBP] = {
		_meta: { title: "Fallback SaveAnimatedWEBP" },
		class_type: "SaveAnimatedWEBP",
		inputs: {
			filename_prefix: "ltx-23-anim",
			fps,
			images: [NODE_VAE_DECODE_IMAGES, 0],
			lossless: false,
			method: "default",
			quality: 90,
		},
	};
}

function repairVhsMp4(
	graph: Record<string, ComfyUINodeApiInput>,
	fps: number
): void {
	const node = graph[NODE_VHS_MP4];
	if (!node || node.class_type !== "VHS_VideoCombine") {
		return;
	}
	if (!graph[NODE_VAE_DECODE_IMAGES]) {
		return;
	}
	node._meta = { title: "VHS_VideoCombine (h264 mp4, no audio)" };
	const cleanedInputs: Record<string, unknown> = {
		crf: 19,
		filename_prefix: "ltx-23-mp4",
		format: "video/h264-mp4",
		frame_rate: fps,
		images: [NODE_VAE_DECODE_IMAGES, 0],
		loop_count: 0,
		pingpong: false,
		pix_fmt: "yuv420p",
		save_metadata: false,
		save_output: true,
	};
	node.inputs = cleanedInputs;
}

function bypassTextGenerateLtx2Prompt(
	graph: Record<string, ComfyUINodeApiInput>
): void {
	const positive = graph[NODE_POSITIVE_CLIP_ENCODE];
	if (positive?.inputs) {
		const currentText = positive.inputs.text;
		if (
			Array.isArray(currentText) &&
			currentText.length === 2 &&
			currentText[0] === NODE_TEXT_GENERATE_LTX2
		) {
			positive.inputs.text = [NODE_PROMPT, 0];
		}
	}
	delete graph[NODE_TEXT_GENERATE_LTX2];
	delete graph[NODE_PROMPT_INSTRUCT_PRIMITIVE];
	delete graph[NODE_PROMPT_CONCATENATE];
	delete graph[NODE_PREVIEW_ANY];
}

function bypassAudioBranch(graph: Record<string, ComfyUINodeApiInput>): void {
	// Audio chain (196 VAELoaderKJ → 199 LTXVEmptyLatentAudio → 109
	// LTXVConcatAVLatent.audio_latent) необходима для LTX2 sampler — без
	// валидного audio latent KSampler падает с "too many values to
	// unpack" (5D AV tensor invariant).
	//
	// На volume лежит правильный bf16 audio VAE
	// (Kijai/LTX2.3_comfy/vae/LTX23_audio_vae_bf16.safetensors, 365 MB,
	// см. sentinel в response). Файл скачан bootstrap'ом в
	// /runpod-volume/ComfyUI/models/vae/, поэтому относительный путь
	// должен быть БЕЗ префикса `vae/` — иначе VAELoaderKJ ищет в
	// `models/vae/vae/...` и возвращает None. Standard VAELoader (как у
	// 184 для video VAE) прощает префикс, custom Kijai loader строже.
	//
	// Поэтому: оставляем 196 как VAELoaderKJ, нормализуем vae_name,
	// чистим обвес audio-decode'а (201 → 140.audio) и audio VAE второго
	// pass'а (тоже 201, уже удалён в bypassSpatialUpscale).
	const audioVaeLoader = graph[NODE_AUDIO_VAE_LOADER];
	if (audioVaeLoader?.inputs) {
		// Нормализуем vae_name (убираем дублирующий префикс `vae/`,
		// чтобы loader искал в корне VAE search path: см. обсуждение
		// HF Kijai/LTX2.3_comfy discussion 5).
		const vaeName = audioVaeLoader.inputs.vae_name;
		if (typeof vaeName === "string" && vaeName.startsWith("vae/")) {
			audioVaeLoader.inputs.vae_name = vaeName.slice("vae/".length);
		}
	}
	delete graph[NODE_SECOND_PASS_AUDIO_VAE];
}

function bypassSpatialUpscale(
	graph: Record<string, ComfyUINodeApiInput>
): void {
	const vaeDecode = graph[NODE_VAE_DECODE_IMAGES];
	if (vaeDecode?.inputs) {
		const samples = vaeDecode.inputs.samples;
		if (
			Array.isArray(samples) &&
			samples.length === 2 &&
			samples[0] === NODE_SECOND_PASS_SEPARATE_AV
		) {
			vaeDecode.inputs.samples = [NODE_FIRST_PASS_SEPARATE_AV, 0];
		}
	}
	// Audio VAE декодер во втором pass'е тоже завязан на second pass sampler;
	// направляем его на first pass, чтобы аудио ветка (если активна) не
	// ломалась — впрочем для текущей задачи (mp4 без звука) это не критично.
	const audioVae = graph[NODE_SECOND_PASS_AUDIO_VAE];
	if (audioVae?.inputs) {
		const samples = audioVae.inputs.samples;
		if (
			Array.isArray(samples) &&
			samples.length === 2 &&
			samples[0] === NODE_SECOND_PASS_SEPARATE_AV
		) {
			audioVae.inputs.samples = [NODE_FIRST_PASS_SEPARATE_AV, 1];
		}
	}
	delete graph[NODE_LATENT_UPSCALER];
	delete graph[NODE_LATENT_UPSCALER_MODEL_LOADER];
	delete graph[NODE_SECOND_PASS_IMG2VIDEO];
	delete graph[NODE_SECOND_PASS_CONCAT_AV];
	delete graph[NODE_SECOND_PASS_SAMPLER];
	delete graph[NODE_SECOND_PASS_SEPARATE_AV];
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

function bypassLoraManagerNode(
	graph: Record<string, ComfyUINodeApiInput>,
	nodeId: string
): void {
	const node = graph[nodeId];
	if (!node) {
		return;
	}
	const upstreamModel = node.inputs?.model;
	if (!Array.isArray(upstreamModel)) {
		return;
	}
	// Перенаправляем всех consumers, ссылавшихся на nodeId, напрямую на
	// upstream model — узел LoraManager у нас всегда passthrough (нулевой
	// массив loras), так что результат эквивалентен.
	for (const consumer of Object.values(graph)) {
		const inputs = consumer.inputs;
		if (!inputs) {
			continue;
		}
		for (const [key, value] of Object.entries(inputs)) {
			if (Array.isArray(value) && value.length === 2 && value[0] === nodeId) {
				inputs[key] = upstreamModel;
			}
		}
	}
	delete graph[nodeId];
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
