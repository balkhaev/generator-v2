import type {
	WorkflowField,
	WorkflowPreset,
	WorkflowSummary,
} from "@generator/contracts/generator";
import { z } from "zod";

import { collectArtifactUrls } from "./artifact-output";
import type * as WorkflowTypes from "./workflow-types";

export type { WorkflowDefinition } from "./workflow-types";

const optionalUrlParamSchema = z.preprocess(
	(value) =>
		typeof value === "string" && value.trim() === "" ? undefined : value,
	z.string().url().optional()
);

const FOOOCUS_BASE_MODEL_NAME = "juggernautXL_version6Rundiffusion.safetensors";
const FOOOCUS_REFINER_MODEL_NAME = "sd_xl_refiner_1.0_0.9vae.safetensors";
const FOOOCUS_DISABLED_MODEL_NAME = "None";
const CIVITAI_LUSTIFY_OLT_MODEL_URN =
	"urn:air:sdxl:checkpoint:civitai:573152@1569593";
const CIVITAI_LTX23_DEFAULT_LORA_MODEL_ID = 2_509_189;
const CIVITAI_LTX23_DEFAULT_LORA_VERSION_ID = 2_820_451;
const CIVITAI_LTX23_DEFAULT_LORA_NAME = "Synth Pussy - LTX 2.3";
const CIVITAI_LTX23_DEFAULT_LORA_SOURCE_URL =
	"https://civitai.com/models/2509189/synth-pussy-ltx-23?modelVersionId=2820451";
const CIVITAI_LTX23_SYNTH_LORA_URN =
	"urn:air:ltxv23:lora:civitai:2509189@2820451";
const CIVITAI_LTX23_SYNTH_ENDPOINT_PREFIX = "ltx2.3:synth-lora";
const RUNPOD_LTX23_POD_KEY = "ltx-2-3-video";
const RUNPOD_WAN22_VIDEO_KEY = "wan-2-2-video";
/** Civitai «Wan2.2 - Pussy (T2V/I2V)» — dual high/low noise LoRA (zip on volume). */
export const CIVITAI_WAN22_PUSSY_MODEL_ID = 1_895_314;
export const CIVITAI_WAN22_PUSSY_VERSION_ID = 2_145_434;
export const CIVITAI_WAN22_PUSSY_SOURCE_URL =
	"https://civitai.com/models/1895314/wan22-pussy-t2vi2v?modelVersionId=2145434";
export const RUNPOD_WAN22_PUSSY_LORA_HIGH_FILENAME =
	"wan22-pussy-high_noise.safetensors";
export const RUNPOD_WAN22_PUSSY_LORA_LOW_FILENAME =
	"wan22-pussy-low_noise.safetensors";
const RUNPOD_FLUX_DEV_IMAGE_KEY = "flux-dev-image";
const RUNPOD_FLUX_DETAILER_KEY = "flux-dev-detailer";
/** RunPod serverless TTS воркеры (общий контракт `tts-serverless`). */
const RUNPOD_VOXCPM_TTS_KEY = "tts-voxcpm";
const RUNPOD_HIGGS_TTS_KEY = "tts-higgs";
/**
 * «Noisify» — Flux.1-dev LoRA (raw grainy snapshot aesthetic), хостится на
 * нашем S3. Файл pre-provisioned на network volume Flux endpoint'а под именем
 * ниже. Источник — внешний LoRA, ранее использовался на fal-flux-dev.
 */
export const RUNPOD_FLUX_NOISIFY_LORA_FILENAME = "noisify.safetensors";
export const RUNPOD_FLUX_NOISIFY_LORA_SOURCE_URL =
	"https://hel1.your-objectstorage.com/generator/loras/external/external-7919a4063730eca7.safetensors";
const REPLICATE_FOOOCUS_API_VERSION =
	"bd7d45104209dc3e1e2765d364697f1393a92a210a0e47fdf943afbd2271a48c";
const REPLICATE_WAN_22_I2V_FAST_VERSION =
	"4eaf2b01d3bf70d8a2e00b219efeb7cb415855ad18b7dacdc4cae664a73a6eea";
const REPLICATE_WAN_22_T2V_FAST_VERSION =
	"c483b1f7b892065bc58ebadb6381abf557f6b1f517d2ff0febb3fb635cf49b4d";
// black-forest-labs/flux-dev-lora — drop-in NSFW-friendly substitute for
// fal-ai/flux-lora after fal started forcing output safety check on flux LoRA
// (regression observed 2026-05-13). Replicate honours `disable_safety_checker`.
const REPLICATE_FLUX_DEV_LORA_VERSION =
	"ae0d7d645446924cf1871e3ca8796e8318f72465d2b5af9323a835df93bf0917";
const FOOOCUS_ASPECT_RATIOS = {
	landscape_4_3: "1152*896",
	landscape_16_9: "1344*768",
	portrait_4_3: "896*1152",
	portrait_16_9: "768*1344",
	square: "1024*1024",
	square_hd: "1024*1024",
} as const;
// Replicate flux-dev-lora exposes `aspect_ratio` as a string, not a size preset.
const REPLICATE_FLUX_DEV_LORA_ASPECT_RATIO = {
	landscape_4_3: "4:3",
	landscape_16_9: "16:9",
	portrait_4_3: "3:4",
	portrait_16_9: "9:16",
	square: "1:1",
	square_hd: "1:1",
} as const;

const booleanParamSchema = (defaultValue: boolean) =>
	z.preprocess((value) => {
		if (value === "true") {
			return true;
		}
		if (value === "false") {
			return false;
		}
		return value;
	}, z.boolean().default(defaultValue));

const runpodFooocusSdxlParamsSchema = z.object({
	imageSize: z
		.enum([
			"square_hd",
			"square",
			"landscape_4_3",
			"landscape_16_9",
			"portrait_4_3",
			"portrait_16_9",
		])
		.default("square_hd"),
	numInferenceSteps: z.number().int().min(1).max(60).default(30),
	guidanceScale: z.number().min(0).max(20).default(4),
	numImages: z.number().int().min(1).max(8).default(1),
	negativePrompt: z.string().default(""),
	outputFormat: z.enum(["jpeg", "png"]).default("jpeg"),
	baseModelName: z.string().min(1).default(FOOOCUS_BASE_MODEL_NAME),
	enableRefiner: booleanParamSchema(true),
	seed: z.number().int().nonnegative().optional(),
	loraUrl: optionalUrlParamSchema,
	loraWeight: z.number().min(0).max(2).default(1),
	extraLoraUrl: optionalUrlParamSchema,
	extraLoraWeight: z.number().min(0).max(2).default(0.5),
});

const ltx23DimensionSchema = z
	.number()
	.int()
	.min(512)
	.max(1536)
	.refine((value) => value % 32 === 0, {
		message: "LTX 2.3 width/height must be divisible by 32",
	});

const ltx23FrameCountSchema = z
	.number()
	.int()
	.min(17)
	.max(361)
	// Вместо отказа на не-8n+1 тихо снапим к ближайшему валидному кадру.
	// Иначе редактирование сценария («указать 24 кадра») падало с ошибкой
	// валидации вместо разумного округления.
	.transform((value) => snapLtx23FrameCount(value));

/**
 * Параметры RunPod LTX 2.3 image-to-video workflow поверх pre-provisioned
 * template `p4f6rm9tb4`. Pod уже содержит ComfyUI + модели LTX 2.3, наш
 * engine только патчит API graph (templates/api/ltx-2-3-i2v-lvram.json) и
 * скачивает указанную Civitai LoRA через Lora Manager API в самом pod'е.
 */
const runpodLtx23ParamsSchema = z.object({
	width: ltx23DimensionSchema.default(896),
	height: ltx23DimensionSchema.default(1280),
	durationSeconds: z.number().min(1).max(16).default(10),
	numFrames: ltx23FrameCountSchema.optional(),
	fps: z.number().int().min(8).max(60).default(24),
	steps: z.number().int().min(1).max(40).default(8),
	cfgScale: z.number().min(0).max(20).default(1),
	negativePrompt: z
		.string()
		.default(
			"news broadcast, 3d animation, computer graphics, pc game, console game, video game, cartoon, childish, watermark, logo, text, on screen text, subtitles, titles, signature, slowmo, static, ugly"
		),
	seed: z.number().int().nonnegative().optional(),
	loraCivitaiModelId: z.coerce.number().int().positive().optional(),
	loraCivitaiVersionId: z.coerce.number().int().positive().optional(),
	// Concept-LoRA поверх distill-LoRA на 1.0 «плавит» лица; 0.7 — безопасный
	// дефолт, сохраняющий концепт без деградации лица.
	loraScale: z.number().min(0).max(2).default(0.7),
	// Бесшовная петля: рендер forward+reverse (VHS pingpong) — последний кадр
	// совпадает с первым, без crossfade и склейки. Для зацикленных live-клипов.
	pingpong: z.coerce.boolean().default(false),
});

// Wan 2.2 latent patchify требует кратность 16 по обеим осям; длина — 4n+1.
const wan22DimensionSchema = z
	.number()
	.int()
	.min(256)
	.max(1280)
	.refine((value) => value % 16 === 0, {
		message: "Wan 2.2 width/height must be divisible by 16",
	});

const wan22FrameCountSchema = z
	.number()
	.int()
	.min(17)
	.max(121)
	// Тихий снап к ближайшему 4n+1 вместо ошибки валидации — чтобы любое
	// введённое в редакторе число кадров (например 24) сохранялось и
	// исполнялось как валидное (25), а не падало.
	.transform((value) => snapWan22FrameCount(value));

/**
 * Параметры RunPod Wan 2.2 image-to-video serverless workflow. Endpoint
 * переиспользует worker-comfyui образ (Wan-ноды есть в ComfyUI core), модели
 * Wan 2.2 лежат на network volume. Граф патчится в
 * `wan-2-2-video-serverless.ts`. LoRA («Wan Pussy» и пр.) опциональна и
 * задаётся через Civitai model id + version id — файл должен быть
 * pre-provisioned на volume: либо `loraHighFilename` + `loraLowFilename` (dual-expert,
 * например Wan Pussy), либо legacy `civitai-{modelId}-{versionId}.safetensors`.
 */
const runpodWan22ParamsSchema = z.object({
	width: wan22DimensionSchema.default(480),
	height: wan22DimensionSchema.default(832),
	durationSeconds: z.number().min(1).max(8).default(5),
	numFrames: wan22FrameCountSchema.optional(),
	fps: z.number().int().min(8).max(30).default(16),
	steps: z.number().int().min(1).max(40).default(20),
	cfgScale: z.number().min(0).max(20).default(3.5),
	negativePrompt: z.string().default(""),
	seed: z.number().int().nonnegative().optional(),
	loraCivitaiModelId: z.coerce.number().int().positive().optional(),
	loraCivitaiVersionId: z.coerce.number().int().positive().optional(),
	loraHighFilename: z.string().min(1).optional(),
	loraLowFilename: z.string().min(1).optional(),
	loraScale: z.number().min(0).max(2).default(1),
});

// Flux latent: /8 downscale + 2×2 patchify ⇒ обе оси должны быть кратны 16.
const fluxDimensionSchema = z
	.number()
	.int()
	.min(256)
	.max(1536)
	.refine((value) => value % 16 === 0, {
		message: "Flux width/height must be divisible by 16",
	});

/**
 * Параметры RunPod Flux.1-dev text-to-image serverless workflow. Endpoint
 * переиспользует worker-comfyui образ (Flux-ноды есть в ComfyUI core),
 * all-in-one fp8-чекпоинт + LoRA лежат на network volume. Граф патчится в
 * `flux-dev-image-serverless.ts`. LoRA («Noisify» и пр.) опциональна и
 * задаётся через `loraFilename` (файл pre-provisioned на volume).
 */
const runpodFluxDevParamsSchema = z.object({
	width: fluxDimensionSchema.default(896),
	height: fluxDimensionSchema.default(1152),
	steps: z.number().int().min(1).max(60).default(28),
	guidance: z.number().min(0).max(20).default(3.5),
	numImages: z.number().int().min(1).max(4).default(1),
	negativePrompt: z.string().default(""),
	seed: z.number().int().nonnegative().optional(),
	loraFilename: z.string().min(1).optional(),
	loraScale: z.number().min(0).max(2).default(1),
});

/**
 * Параметры RunPod Flux.1-dev детейлера. Переиспользует тот же flux endpoint
 * и all-in-one fp8-чекпоинт, но граф — img2img: пиксельный апскейл (upscaleBy)
 * + низкий denoise (strength) для добавления деталей без потери композиции.
 * Граф патчится в `flux-dev-detailer-serverless.ts`.
 */
const runpodFluxDetailerParamsSchema = z.object({
	denoise: z.number().min(0.05).max(1).default(0.4),
	upscaleBy: z.number().min(1).max(2).default(1.5),
	steps: z.number().int().min(1).max(60).default(20),
	guidance: z.number().min(0).max(20).default(3.5),
	negativePrompt: z.string().default(""),
	seed: z.number().int().nonnegative().optional(),
});

const replicateFooocusSdxlParamsSchema = z.object({
	imageSize: z
		.enum([
			"square_hd",
			"square",
			"landscape_4_3",
			"landscape_16_9",
			"portrait_4_3",
			"portrait_16_9",
		])
		.default("square_hd"),
	performanceSelection: z
		.enum(["Speed", "Quality", "Extreme Speed"])
		.default("Speed"),
	styleSelections: z
		.string()
		.default("Fooocus V2,Fooocus Enhance,Fooocus Sharp"),
	numImages: z.number().int().min(1).max(8).default(1),
	guidanceScale: z.number().min(1).max(30).default(7),
	negativePrompt: z.string().default(""),
	seed: z.number().int().nonnegative().optional(),
	useDefaultLoras: booleanParamSchema(false),
	loraUrl: optionalUrlParamSchema,
	loraWeight: z.number().min(0).max(2).default(1),
	extraLoraUrl: optionalUrlParamSchema,
	extraLoraWeight: z.number().min(0).max(2).default(0.5),
	sharpness: z.number().min(0).max(30).default(2),
	refinerSwitch: z.number().min(0.1).max(1).default(0.5),
});

const civitaiSchedulerSchema = z
	.enum([
		"EulerA",
		"Euler",
		"LMS",
		"Heun",
		"DPM2",
		"DPM2A",
		"DPM2SA",
		"DPM2M",
		"DPMSDE",
		"DPMFast",
		"DPMAdaptive",
		"LMSKarras",
		"DPM2Karras",
		"DPM2AKarras",
		"DPM2SAKarras",
		"DPM2MKarras",
		"DPMSDEKarras",
		"DDIM",
		"PLMS",
		"UniPC",
		"LCM",
		"DDPM",
		"DEIS",
	])
	.default("DPM2MKarras");

const civitaiLustifyOltSdxlParamsSchema = z.object({
	width: z.number().int().min(512).max(1536).default(832),
	height: z.number().int().min(512).max(1536).default(1216),
	steps: z.number().int().min(1).max(60).default(30),
	cfgScale: z.number().min(0).max(20).default(3.5),
	scheduler: civitaiSchedulerSchema,
	numImages: z.number().int().min(1).max(4).default(1),
	negativePrompt: z.string().default(""),
	clipSkip: z.number().int().min(1).max(12).default(2),
	seed: z.number().int().nonnegative().optional(),
});

const civitaiLtx23ResolutionSchema = z.enum(["720p", "1080p"]).default("720p");
const civitaiLtx23AspectRatioSchema = z
	.enum(["16:9", "3:2", "1:1", "2:3", "9:16"])
	.default("16:9");
const CIVITAI_LTX23_ALLOWED_DURATIONS = [
	3, 6, 8, 10, 12, 14, 16, 18, 20,
] as const;
const CIVITAI_LTX23_DURATION_OPTIONS = CIVITAI_LTX23_ALLOWED_DURATIONS.map(
	(duration) => String(duration)
);
const CIVITAI_LTX23_DEFAULT_DURATION = 3;

function isCivitaiLtx23Duration(
	value: number
): value is (typeof CIVITAI_LTX23_ALLOWED_DURATIONS)[number] {
	return CIVITAI_LTX23_ALLOWED_DURATIONS.some((duration) => duration === value);
}

function normalizeCivitaiLtx23Duration(value: unknown) {
	if (value === undefined || value === null || value === "") {
		return CIVITAI_LTX23_DEFAULT_DURATION;
	}
	const parsed = Number(value);
	return isCivitaiLtx23Duration(parsed)
		? parsed
		: CIVITAI_LTX23_DEFAULT_DURATION;
}

const civitaiLtx23DurationSchema = z.preprocess(
	normalizeCivitaiLtx23Duration,
	z
		.number()
		.int()
		.refine(isCivitaiLtx23Duration, {
			message: `Duration must be one of ${CIVITAI_LTX23_DURATION_OPTIONS.join(", ")}`,
		})
);

const civitaiLtx23SynthParamsSchema = z.object({
	resolution: civitaiLtx23ResolutionSchema,
	aspectRatio: civitaiLtx23AspectRatioSchema,
	duration: civitaiLtx23DurationSchema,
	steps: z.number().int().min(10).max(50).default(30),
	guidanceScale: z.number().min(1).max(10).default(3),
	generateAudio: booleanParamSchema(false),
	seed: z.number().int().nonnegative().optional(),
	loraSourceUrl: z.url().default(CIVITAI_LTX23_DEFAULT_LORA_SOURCE_URL),
	loraAir: z.string().min(1).default(CIVITAI_LTX23_SYNTH_LORA_URN),
	loraModelId: z
		.number()
		.int()
		.positive()
		.default(CIVITAI_LTX23_DEFAULT_LORA_MODEL_ID),
	loraVersionId: z
		.number()
		.int()
		.positive()
		.default(CIVITAI_LTX23_DEFAULT_LORA_VERSION_ID),
	loraName: z.string().min(1).default(CIVITAI_LTX23_DEFAULT_LORA_NAME),
	loraBaseModel: z.string().min(1).default("ltx-2-3"),
	loraSupportsGeneration: booleanParamSchema(true),
	loraTriggerWords: z.string().default(""),
	loraStrength: z.number().min(0).max(2).default(1),
});

const civitaiLtx23SynthImageToVideoParamsSchema =
	civitaiLtx23SynthParamsSchema.extend({
		endImageUrl: optionalUrlParamSchema,
	});

// Dedicated first/last-frame LTX 2.3 workflow WITHOUT any LoRA. Built for clean,
// SFW looping clips (e.g. reactive avatars): we pass the same image as both the
// first and last frame so the model animates a motion that starts and ends on
// the identical pose — a true seamless loop with no crossfade. Portrait aspect
// ratio by default since avatars are portrait. No `loras` are sent, so this runs
// on the base Civitai LTX 2.3 engine.
const civitaiLtx23FlfAspectRatioSchema = z
	.enum(["16:9", "3:2", "1:1", "2:3", "9:16"])
	.default("9:16");

const civitaiLtx23FlfParamsSchema = z.object({
	resolution: civitaiLtx23ResolutionSchema,
	aspectRatio: civitaiLtx23FlfAspectRatioSchema,
	duration: civitaiLtx23DurationSchema,
	steps: z.number().int().min(10).max(50).default(30),
	guidanceScale: z.number().min(1).max(10).default(3),
	generateAudio: booleanParamSchema(false),
	seed: z.number().int().nonnegative().optional(),
	endImageUrl: optionalUrlParamSchema,
});

type CivitaiLtx23FlfParams = z.infer<typeof civitaiLtx23FlfParamsSchema>;

const CIVITAI_LTX23_DIMENSIONS = {
	"720p": {
		"16:9": { width: 1280, height: 720 },
		"3:2": { width: 1176, height: 784 },
		"1:1": { width: 960, height: 960 },
		"2:3": { width: 784, height: 1176 },
		"9:16": { width: 720, height: 1280 },
	},
	"1080p": {
		"16:9": { width: 1920, height: 1080 },
		"3:2": { width: 1764, height: 1176 },
		"1:1": { width: 1440, height: 1440 },
		"2:3": { width: 1176, height: 1764 },
		"9:16": { width: 1080, height: 1920 },
	},
} as const;

type CivitaiLtx23AspectRatio = z.infer<typeof civitaiLtx23AspectRatioSchema>;
type CivitaiLtx23Resolution = z.infer<typeof civitaiLtx23ResolutionSchema>;
type CivitaiLtx23SynthParams = z.infer<typeof civitaiLtx23SynthParamsSchema>;

function getCivitaiLtx23Dimensions(
	resolution: CivitaiLtx23Resolution,
	aspectRatio: CivitaiLtx23AspectRatio
) {
	return CIVITAI_LTX23_DIMENSIONS[resolution][aspectRatio];
}

function buildCivitaiLtx23SynthInput({
	firstFrame,
	lastFrame,
	operation,
	parsed,
	prompt,
}: {
	firstFrame?: string;
	lastFrame?: string;
	operation: "createVideo" | "firstLastFrameToVideo";
	parsed: CivitaiLtx23SynthParams;
	prompt: string;
}): Record<string, unknown> {
	const dimensions = getCivitaiLtx23Dimensions(
		parsed.resolution,
		parsed.aspectRatio
	);
	return {
		__civitaiEndpoint: `${CIVITAI_LTX23_SYNTH_ENDPOINT_PREFIX}:${operation}`,
		$type: "videoGen",
		input: {
			engine: "ltx2.3",
			operation,
			prompt,
			width: dimensions.width,
			height: dimensions.height,
			model: "22b-dev",
			guidanceScale: parsed.guidanceScale,
			steps: parsed.steps,
			duration: parsed.duration,
			generateAudio: parsed.generateAudio,
			loras: {
				[parsed.loraAir]: parsed.loraStrength,
			},
			...(firstFrame ? { firstFrame } : {}),
			...(lastFrame ? { lastFrame } : {}),
			...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
		},
	};
}

function buildCivitaiLtx23FlfInput({
	firstFrame,
	lastFrame,
	parsed,
	prompt,
}: {
	firstFrame?: string;
	lastFrame?: string;
	parsed: CivitaiLtx23FlfParams;
	prompt: string;
}): Record<string, unknown> {
	const dimensions = getCivitaiLtx23Dimensions(
		parsed.resolution,
		parsed.aspectRatio
	);
	return {
		__civitaiEndpoint: "ltx2.3:flf:firstLastFrameToVideo",
		$type: "videoGen",
		input: {
			engine: "ltx2.3",
			operation: "firstLastFrameToVideo",
			prompt,
			width: dimensions.width,
			height: dimensions.height,
			model: "22b-dev",
			guidanceScale: parsed.guidanceScale,
			steps: parsed.steps,
			duration: parsed.duration,
			generateAudio: parsed.generateAudio,
			...(firstFrame ? { firstFrame } : {}),
			...(lastFrame ? { lastFrame } : {}),
			...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
		},
	};
}

// Routes to Replicate's official
// black-forest-labs/flux-dev-lora. Same FLUX.1 [dev] base, same .safetensors
// LoRA URLs, and `disable_safety_checker: true` is actually honoured —
// validated against a live job on 2026-05-18. `goFast` defaults to bf16 for
// quality parity with the pre-regression fal output; flip to true to opt into
// the fp8 quantized fast path (note Replicate auto-applies a 1.5x multiplier
// to lora_scale in that mode).
const replicateFluxDevLoraParamsSchema = z.object({
	imageSize: z
		.enum([
			"square_hd",
			"square",
			"landscape_4_3",
			"landscape_16_9",
			"portrait_4_3",
			"portrait_16_9",
		])
		.default("landscape_4_3"),
	numInferenceSteps: z.number().int().min(1).max(50).default(28),
	guidanceScale: z.number().min(1).max(20).default(3.5),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	disableSafetyChecker: z.boolean().default(true),
	goFast: z.boolean().default(false),
	loraUrl: optionalUrlParamSchema,
	loraScale: z.number().min(0).max(2).default(1),
	extraLoraUrl: optionalUrlParamSchema,
	extraLoraScale: z.number().min(0).max(2).default(0.5),
	outputFormat: z.enum(["webp", "jpg", "png"]).default("jpg"),
	megapixels: z.enum(["1", "0.25"]).default("1"),
});

const replicateWan22FastBaseParamsSchema = z.object({
	numFrames: z.number().int().min(81).max(121).default(81),
	resolution: z.enum(["480p", "720p"]).default("480p"),
	framesPerSecond: z.number().int().min(5).max(30).default(16),
	goFast: booleanParamSchema(true),
	sampleShift: z.number().min(1).max(20).default(12),
	seed: z.number().int().nonnegative().optional(),
	loraUrlHigh: optionalUrlParamSchema,
	loraScaleHigh: z.number().min(0).max(2).default(1),
	loraUrlLow: optionalUrlParamSchema,
	loraScaleLow: z.number().min(0).max(2).default(1),
});

const replicateWan22FastTextToVideoParamsSchema =
	replicateWan22FastBaseParamsSchema.extend({
		aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
		optimizePrompt: booleanParamSchema(false),
		interpolateOutput: booleanParamSchema(true),
	});

const replicateWan22FastImageToVideoParamsSchema =
	replicateWan22FastBaseParamsSchema.extend({
		endImageUrl: optionalUrlParamSchema,
		interpolateOutput: booleanParamSchema(false),
	});

function buildReplicateWanLoraInput(parsed: {
	loraScaleHigh: number;
	loraScaleLow: number;
	loraUrlHigh?: string;
	loraUrlLow?: string;
}): Record<string, unknown> {
	return {
		...(parsed.loraUrlHigh
			? {
					lora_scale_transformer: parsed.loraScaleHigh,
					lora_weights_transformer: parsed.loraUrlHigh,
				}
			: {}),
		...(parsed.loraUrlLow
			? {
					lora_scale_transformer_2: parsed.loraScaleLow,
					lora_weights_transformer_2: parsed.loraUrlLow,
				}
			: {}),
	};
}

function buildReplicateWanFastBaseInput(parsed: {
	framesPerSecond: number;
	goFast: boolean;
	interpolateOutput: boolean;
	numFrames: number;
	resolution: "480p" | "720p";
	sampleShift: number;
	seed?: number;
}): Record<string, unknown> {
	return {
		disable_safety_checker: true,
		frames_per_second: parsed.framesPerSecond,
		go_fast: parsed.goFast,
		interpolate_output: parsed.interpolateOutput,
		num_frames: parsed.numFrames,
		resolution: parsed.resolution,
		sample_shift: parsed.sampleShift,
		...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
	};
}

function buildRunpodFooocusLoras(parsed: {
	extraLoraUrl?: string;
	extraLoraWeight: number;
	loraUrl?: string;
	loraWeight: number;
}): Array<{ model_name: string; url: string; weight: number }> {
	const loras: Array<{ model_name: string; url: string; weight: number }> = [];
	const buildEntry = (url: string, weight: number) => {
		const modelName = extractModelNameFromUrl(url) ?? buildStableLoraName(url);
		return {
			model_name: modelName,
			url,
			weight,
		};
	};
	if (parsed.loraUrl) {
		loras.push(buildEntry(parsed.loraUrl, parsed.loraWeight));
	}
	if (parsed.extraLoraUrl) {
		loras.push(buildEntry(parsed.extraLoraUrl, parsed.extraLoraWeight));
	}
	return loras;
}

function buildRunpodFooocusLoraUrls(
	loras: Array<{ url: string; weight: number }>
): string {
	return loras.map((lora) => `${lora.url},${lora.weight}`).join(";");
}

type RunpodFooocusSdxlParams = z.infer<typeof runpodFooocusSdxlParamsSchema>;
type RunpodLtx23Params = z.infer<typeof runpodLtx23ParamsSchema>;
type RunpodWan22Params = z.infer<typeof runpodWan22ParamsSchema>;
type RunpodFluxDevParams = z.infer<typeof runpodFluxDevParamsSchema>;
type RunpodFluxDetailerParams = z.infer<typeof runpodFluxDetailerParamsSchema>;

function buildRunpodFluxDevInput({
	parsed,
	prompt,
}: {
	parsed: RunpodFluxDevParams;
	prompt: string;
}): Record<string, unknown> {
	const lora = parsed.loraFilename
		? { loraFilename: parsed.loraFilename, loraScale: parsed.loraScale }
		: {};
	return {
		__runpodWorkflow: RUNPOD_FLUX_DEV_IMAGE_KEY,
		prompt,
		negativePrompt: parsed.negativePrompt,
		width: parsed.width,
		height: parsed.height,
		steps: parsed.steps,
		guidance: parsed.guidance,
		numImages: parsed.numImages,
		...lora,
		...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
	};
}

function buildRunpodFluxDetailerInput({
	inputImageUrl,
	parsed,
	prompt,
}: {
	inputImageUrl?: string;
	parsed: RunpodFluxDetailerParams;
	prompt: string;
}): Record<string, unknown> {
	return {
		__runpodWorkflow: RUNPOD_FLUX_DETAILER_KEY,
		prompt,
		negativePrompt: parsed.negativePrompt,
		denoise: parsed.denoise,
		upscaleBy: parsed.upscaleBy,
		steps: parsed.steps,
		guidance: parsed.guidance,
		...(inputImageUrl === undefined ? {} : { inputImageUrl }),
		...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
	};
}

function buildRunpodFooocusSdxlInput({
	parsed,
	prompt,
}: {
	parsed: RunpodFooocusSdxlParams;
	prompt: string;
}): Record<string, unknown> {
	const loras = buildRunpodFooocusLoras(parsed);
	return {
		__runpodWorkflow: "fooocus-sdxl",
		api_name: "txt2img",
		prompt,
		// Fooocus-API-LORA accepts these native field names. The RunPod
		// worker still gets image_size/num_images aliases for simpler output
		// adapters, but should call Fooocus with the native names below.
		base_model_name: parsed.baseModelName,
		advanced_params: {
			overwrite_step: parsed.numInferenceSteps,
		},
		aspect_ratios_selection: FOOOCUS_ASPECT_RATIOS[parsed.imageSize],
		image_size: parsed.imageSize,
		image_number: parsed.numImages,
		num_inference_steps: parsed.numInferenceSteps,
		guidance_scale: parsed.guidanceScale,
		num_images: parsed.numImages,
		negative_prompt: parsed.negativePrompt,
		output_format: parsed.outputFormat,
		enable_refiner: parsed.enableRefiner,
		enable_safety_checker: false,
		require_base64: true,
		refiner_model_name: parsed.enableRefiner
			? FOOOCUS_REFINER_MODEL_NAME
			: FOOOCUS_DISABLED_MODEL_NAME,
		refiner_switch: 0.5,
		loras,
		loras_custom_urls: buildRunpodFooocusLoraUrls(loras),
		...(parsed.seed === undefined
			? {}
			: { image_seed: parsed.seed, seed: parsed.seed }),
	};
}

// LTX 2.3 требует кадры вида 8n+1. Снапим любое значение к ближайшему
// валидному и клампим в [17, 361]. Используется и схемой (явный numFrames),
// и normalize-путём (из duration*fps), чтобы UX-редактирование не падало:
// например 24 → 25.
function snapLtx23FrameCount(rawFrames: number): number {
	const normalized = Math.round((rawFrames - 1) / 8) * 8 + 1;
	return Math.min(361, Math.max(17, normalized));
}

function normalizeLtx23FrameCount(
	durationSeconds: number,
	fps: number
): number {
	return snapLtx23FrameCount(Math.round(durationSeconds * fps));
}

function buildRunpodLtx23Input({
	inputImageUrl,
	parsed,
	prompt,
}: {
	inputImageUrl?: string;
	parsed: RunpodLtx23Params;
	prompt: string;
}): Record<string, unknown> {
	const numFrames =
		parsed.numFrames ??
		normalizeLtx23FrameCount(parsed.durationSeconds, parsed.fps);
	const lora =
		parsed.loraCivitaiModelId === undefined ||
		parsed.loraCivitaiVersionId === undefined
			? {}
			: {
					loraCivitaiModelId: parsed.loraCivitaiModelId,
					loraCivitaiVersionId: parsed.loraCivitaiVersionId,
					loraScale: parsed.loraScale,
				};
	return {
		__runpodWorkflow: RUNPOD_LTX23_POD_KEY,
		prompt,
		negativePrompt: parsed.negativePrompt,
		width: parsed.width,
		height: parsed.height,
		numFrames,
		fps: parsed.fps,
		steps: parsed.steps,
		cfgScale: parsed.cfgScale,
		pingpong: parsed.pingpong,
		...lora,
		...(inputImageUrl === undefined ? {} : { inputImageUrl }),
		...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
	};
}

// Wan 2.2 требует кадры вида 4n+1. Снапим к ближайшему валидному и клампим
// в [17, 121]. Общая математика для схемы (явный numFrames) и normalize-пути
// (из duration*fps): редактирование «24 кадра» больше не падает, а тихо
// округляется до 25.
function snapWan22FrameCount(rawFrames: number): number {
	const normalized = Math.round((rawFrames - 1) / 4) * 4 + 1;
	return Math.min(121, Math.max(17, normalized));
}

function normalizeWan22FrameCount(
	durationSeconds: number,
	fps: number
): number {
	return snapWan22FrameCount(Math.round(durationSeconds * fps));
}

function buildRunpodWan22Input({
	inputImageUrl,
	parsed,
	prompt,
}: {
	inputImageUrl?: string;
	parsed: RunpodWan22Params;
	prompt: string;
}): Record<string, unknown> {
	const numFrames =
		parsed.numFrames ??
		normalizeWan22FrameCount(parsed.durationSeconds, parsed.fps);
	const loraFromFilenames =
		parsed.loraHighFilename && parsed.loraLowFilename
			? {
					loraHighFilename: parsed.loraHighFilename,
					loraLowFilename: parsed.loraLowFilename,
					loraScale: parsed.loraScale,
				}
			: {};
	const loraFromCivitai =
		parsed.loraCivitaiModelId !== undefined &&
		parsed.loraCivitaiVersionId !== undefined
			? {
					loraCivitaiModelId: parsed.loraCivitaiModelId,
					loraCivitaiVersionId: parsed.loraCivitaiVersionId,
					loraScale: parsed.loraScale,
				}
			: {};
	return {
		__runpodWorkflow: RUNPOD_WAN22_VIDEO_KEY,
		prompt,
		negativePrompt: parsed.negativePrompt,
		width: parsed.width,
		height: parsed.height,
		numFrames,
		fps: parsed.fps,
		steps: parsed.steps,
		cfgScale: parsed.cfgScale,
		...loraFromFilenames,
		...loraFromCivitai,
		...(inputImageUrl === undefined ? {} : { inputImageUrl }),
		...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
	};
}

function collectRunpodPodVideoUrls(output: unknown): string[] {
	if (!output || typeof output !== "object") {
		return [];
	}
	const videoUrl = (output as Record<string, unknown>).videoUrl;
	return typeof videoUrl === "string" && videoUrl.length > 0 ? [videoUrl] : [];
}

const runpodTtsParamsSchema = z
	.object({
		referenceAudioUrl: optionalUrlParamSchema,
		referenceText: z.string().trim().optional(),
		language: z.string().trim().optional(),
		style: z.string().trim().optional(),
		emotion: z.string().trim().optional(),
		cfgValue: z.coerce.number().finite().optional(),
		inferenceTimesteps: z.coerce.number().int().finite().optional(),
		temperature: z.coerce.number().finite().optional(),
		topK: z.coerce.number().int().finite().optional(),
		maxNewTokens: z.coerce.number().int().finite().optional(),
	})
	.passthrough();

type RunpodTtsParsedParams = z.output<typeof runpodTtsParamsSchema>;

const runpodTtsParameterFields: readonly WorkflowField[] = [
	{
		description:
			"Публичный URL reference-аудио (WAV/mp3) для клонирования голоса.",
		key: "referenceAudioUrl",
		kind: "audio-url",
		label: "Reference voice",
		optional: true,
		type: "text",
	},
	{
		description: "Транскрипт reference-аудио — повышает точность клонирования.",
		key: "referenceText",
		label: "Reference text",
		optional: true,
		type: "text",
	},
	{
		description:
			"Описание стиля/эмоции голоса (voice design), напр. «warm calm female».",
		key: "style",
		label: "Voice style",
		optional: true,
		type: "text",
	},
	{
		description: "Язык синтеза (auto у VoxCPM, подсказка для Higgs).",
		key: "language",
		label: "Language",
		optional: true,
		type: "text",
	},
];

function buildRunpodTtsInput(args: {
	parsed: RunpodTtsParsedParams;
	prompt: string;
	workflowKey: string;
}): Record<string, unknown> {
	const { parsed, prompt, workflowKey } = args;
	const text = prompt.trim();
	if (text.length === 0) {
		throw new Error("TTS workflow requires non-empty prompt text");
	}
	const input: Record<string, unknown> = {
		__runpodWorkflow: workflowKey,
		text,
	};
	const optionalEntries: [string, unknown][] = [
		["referenceAudioUrl", parsed.referenceAudioUrl],
		["referenceText", parsed.referenceText],
		["language", parsed.language],
		["style", parsed.style],
		["emotion", parsed.emotion],
		["cfgValue", parsed.cfgValue],
		["inferenceTimesteps", parsed.inferenceTimesteps],
		["temperature", parsed.temperature],
		["topK", parsed.topK],
		["maxNewTokens", parsed.maxNewTokens],
	];
	for (const [key, value] of optionalEntries) {
		if (value !== undefined && value !== "") {
			input[key] = value;
		}
	}
	return input;
}

/**
 * Извлекает URL аудио-артефактов из TTS serverless воркеров. Воркер
 * (`tts-serverless`) нормализует output в `{ audioUrl }`; на всякий случай
 * поддерживаем и сырой `audio[]` shape от handler'а (`{type:"s3_url", data}`).
 */
function collectRunpodTtsAudioUrls(output: unknown): string[] {
	if (!output || typeof output !== "object") {
		return [];
	}
	const record = output as Record<string, unknown>;
	const directAudioUrl = record.audioUrl;
	if (typeof directAudioUrl === "string" && directAudioUrl.length > 0) {
		return [directAudioUrl];
	}
	const audio = record.audio;
	if (Array.isArray(audio)) {
		const urls: string[] = [];
		for (const item of audio) {
			if (item && typeof item === "object") {
				const entry = item as Record<string, unknown>;
				const data = entry.data;
				if (
					entry.type === "s3_url" &&
					typeof data === "string" &&
					data.length > 0
				) {
					urls.push(data);
				}
			}
		}
		if (urls.length > 0) {
			return urls;
		}
	}
	return [];
}

function extractModelNameFromUrl(url: string): string | undefined {
	try {
		const pathname = new URL(url).pathname;
		const fileName = decodeURIComponent(pathname.split("/").pop() ?? "");
		return fileName.toLowerCase().endsWith(".safetensors")
			? fileName
			: undefined;
	} catch {
		return;
	}
}

function buildStableLoraName(url: string): string {
	let hash = 0;
	for (const char of url) {
		hash = (hash * 31 + char.charCodeAt(0)) % 4_294_967_291;
	}
	return `${Math.trunc(hash).toString(36).padStart(8, "0")}.safetensors`;
}

const wanLoraParameterFields: readonly WorkflowField[] = [
	{
		description:
			"Optional public URL pointing to the high-noise Wan 2.2 LoRA weights.",
		key: "loraUrlHigh",
		kind: "lora-url",
		label: "LoRA High",
		type: "text",
	},
	{
		description: "Strength of the high-noise LoRA (ignored when no URL set).",
		key: "loraScaleHigh",
		label: "High scale",
		type: "number",
	},
	{
		description:
			"Optional public URL pointing to the low-noise Wan 2.2 LoRA weights.",
		key: "loraUrlLow",
		kind: "lora-url",
		label: "LoRA Low",
		type: "text",
	},
	{
		description: "Strength of the low-noise LoRA (ignored when no URL set).",
		key: "loraScaleLow",
		label: "Low scale",
		type: "number",
	},
];

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * Полный ожидаемый цикл (включая ~10с очереди fal + сам инференс).
 * Цифры подобраны по живым прод-наблюдениям, а не по «офицальной» оценке
 * провайдера: реальное время на нашем тарифе обычно в 2-3× меньше
 * усреднённых маркетинговых заявлений. Soft-progress кепится 90%, поэтому
 * лучше слегка занизить — тогда индикатор «дойдёт до 90%» примерно одновременно
 * с реальным завершением, а не за минуту до него.
 *
 * Источник чисел для wan/ltx: трассировки prod runs (см. application_logs
 * generator-api), берётся медиана по 5+ запускам.
 */
const WORKFLOW_EXPECTED_DURATION_MS: Record<string, number> = {
	"civitai-lustify-olt-sdxl": 2 * MINUTE,
	"civitai-ltx-2-3-synth-text-to-video": 2 * MINUTE,
	"civitai-ltx-2-3-synth-image-to-video": 2 * MINUTE,
	"civitai-ltx-2-3-flf-image-to-video": 2 * MINUTE,
	"runpod-fooocus-sdxl": 90 * SECOND,
	// Flux img2img detailer: ~10s queue + ~30-40s render (20 steps, upscale 1.5×).
	"runpod-flux-detailer": 45 * SECOND,
	// Always-warm serverless (workersMin=1, flashboot): cold start'ов нет.
	// Измерено на тёплом воркере: delay ~10s + render ~9.2min ≈ 9.5min
	// (512x896, 5s/97 кадров, 8 шагов). Берём 10min с небольшим буфером —
	// soft-progress кепится 90%, недолёт лучше перелёта (бар сидит на 90%,
	// а не ползёт у floor). Редкий cold 2-й воркер просто дольше у 90%.
	"runpod-ltx-2-3-text-to-video": 10 * MINUTE,
	"runpod-ltx-2-3-image-to-video": 10 * MINUTE,
	"runpod-ltx-2-3-synth-text-to-video": 10 * MINUTE,
	// Always-warm serverless Wan 2.2 14B I2V (dual-expert, ~20 steps split).
	// Уточнить по живым трейсам после первого прода; стартовый буфер 5 мин.
	"runpod-wan-2-2-image-to-video": 5 * MINUTE,
	// TTS короткий: cold start + ~5-15s синтеза. Буфер на cold worker.
	"runpod-voxcpm-tts": 45 * SECOND,
	"runpod-higgs-tts": 90 * SECOND,
	"replicate-fooocus-sdxl": 15 * SECOND,
	// bf16 inference измерено 9.7s на 1MP. Добавили буфер на queue + pickup.
	"replicate-flux-dev-lora": 15 * SECOND,
	// queue ~10s + inference ~75-90s (5s 720p video)
	"replicate-wan-2-2-fast-text-to-video": 60 * SECOND,
	"replicate-wan-2-2-fast-image-to-video": 60 * SECOND,
};

const runpodLtx23ParameterFields: readonly WorkflowField[] = [
	{
		description: "Output video width in pixels. Must be divisible by 32.",
		key: "width",
		label: "Width",
		max: 1536,
		min: 512,
		step: 32,
		type: "number",
	},
	{
		description: "Output video height in pixels. Must be divisible by 32.",
		key: "height",
		label: "Height",
		max: 1536,
		min: 512,
		step: 32,
		type: "number",
	},
	{
		description:
			"Target duration in seconds. Converted to an LTX-valid 8n+1 frame count.",
		key: "durationSeconds",
		label: "Duration",
		max: 16,
		min: 1,
		step: 0.5,
		unit: "s",
		type: "number",
	},
	{
		description: "Output frames per second.",
		key: "fps",
		label: "FPS",
		max: 60,
		min: 8,
		step: 1,
		type: "number",
	},
	{
		description: "Number of denoising steps.",
		key: "steps",
		label: "Steps",
		max: 40,
		min: 1,
		step: 1,
		unit: "steps",
		type: "number",
	},
	{
		description: "Classifier-free guidance scale.",
		key: "cfgScale",
		label: "CFG scale",
		max: 20,
		min: 0,
		step: 0.1,
		type: "number",
	},
	{
		description: "Negative prompt to discourage unwanted content.",
		key: "negativePrompt",
		label: "Negative prompt",
		optional: true,
		type: "text",
	},
	{
		description:
			"Civitai model id для LoRA, которую Lora Manager скачает в pod (необязательно).",
		key: "loraCivitaiModelId",
		label: "Civitai model id",
		optional: true,
		type: "number",
	},
	{
		description: "Civitai model version id для LoRA (необязательно).",
		key: "loraCivitaiVersionId",
		label: "Civitai version id",
		optional: true,
		type: "number",
	},
	{
		description: "Strength of the optional LoRA when Civitai ids are provided.",
		key: "loraScale",
		label: "LoRA scale",
		max: 2,
		min: 0,
		step: 0.05,
		type: "number",
	},
	{
		description: "Optional deterministic seed.",
		key: "seed",
		label: "Seed",
		optional: true,
		type: "number",
	},
];

const runpodWan22ParameterFields: readonly WorkflowField[] = [
	{
		description: "Output video width in pixels. Must be divisible by 16.",
		key: "width",
		label: "Width",
		max: 1280,
		min: 256,
		step: 16,
		type: "number",
	},
	{
		description: "Output video height in pixels. Must be divisible by 16.",
		key: "height",
		label: "Height",
		max: 1280,
		min: 256,
		step: 16,
		type: "number",
	},
	{
		description:
			"Target duration in seconds. Converted to a Wan-valid 4n+1 frame count.",
		key: "durationSeconds",
		label: "Duration",
		max: 8,
		min: 1,
		step: 0.5,
		unit: "s",
		type: "number",
	},
	{
		description: "Output frames per second.",
		key: "fps",
		label: "FPS",
		max: 30,
		min: 8,
		step: 1,
		type: "number",
	},
	{
		description: "Total denoising steps (split between high/low experts).",
		key: "steps",
		label: "Steps",
		max: 40,
		min: 1,
		step: 1,
		unit: "steps",
		type: "number",
	},
	{
		description: "Classifier-free guidance scale.",
		key: "cfgScale",
		label: "CFG scale",
		max: 20,
		min: 0,
		step: 0.1,
		type: "number",
	},
	{
		description: "Negative prompt to discourage unwanted content.",
		key: "negativePrompt",
		label: "Negative prompt",
		optional: true,
		type: "text",
	},
	{
		description:
			"Civitai model id для LoRA. Файл должен быть pre-provisioned на network volume (необязательно).",
		key: "loraCivitaiModelId",
		label: "Civitai model id",
		optional: true,
		type: "number",
	},
	{
		description: "Civitai model version id для LoRA (необязательно).",
		key: "loraCivitaiVersionId",
		label: "Civitai version id",
		optional: true,
		type: "number",
	},
	{
		description: "Strength of the optional LoRA when Civitai ids are provided.",
		key: "loraScale",
		label: "LoRA scale",
		max: 2,
		min: 0,
		step: 0.05,
		type: "number",
	},
	{
		description: "Optional deterministic seed.",
		key: "seed",
		label: "Seed",
		optional: true,
		type: "number",
	},
];

// Пресеты LTX 2.3 i2v. distill-LoRA фиксирует cfg≈1, поэтому «качество» растёт
// за счёт разрешения/шагов, а не CFG. Длительность задаётся секундами — кадры
// (8n+1) считаются из durationSeconds*fps в normalizeLtx23FrameCount.
const runpodLtx23Presets: readonly WorkflowPreset[] = [
	{
		description: "640×896, 6 шагов — для быстрой проверки кадра.",
		group: "quality",
		id: "ltx-quality-preview",
		label: "Превью",
		params: { width: 640, height: 896, steps: 6, cfgScale: 1, loraScale: 0.7 },
	},
	{
		description: "896×1280, 8 шагов — баланс скорости и детализации.",
		group: "quality",
		id: "ltx-quality-balanced",
		label: "Баланс",
		params: { width: 896, height: 1280, steps: 8, cfgScale: 1, loraScale: 0.7 },
	},
	{
		description: "896×1280, 12 шагов — максимум резкости.",
		group: "quality",
		id: "ltx-quality-high",
		label: "Качество",
		params: {
			width: 896,
			height: 1280,
			steps: 12,
			cfgScale: 1,
			loraScale: 0.8,
		},
	},
	{
		description: "~3 секунды при 24 fps.",
		group: "duration",
		id: "ltx-duration-3s",
		label: "3 сек",
		params: { durationSeconds: 3, fps: 24 },
	},
	{
		description: "~5 секунд при 24 fps.",
		group: "duration",
		id: "ltx-duration-5s",
		label: "5 сек",
		params: { durationSeconds: 5, fps: 24 },
	},
	{
		description: "~10 секунд при 24 fps.",
		group: "duration",
		id: "ltx-duration-10s",
		label: "10 сек",
		params: { durationSeconds: 10, fps: 24 },
	},
];

// Пресеты Wan 2.2 i2v под lightx2v accel-LoRA (worker всегда подмешивает её):
// distill требует cfg=1 и 4–8 шагов. Длительность — через durationSeconds; fps
// подобран так, чтобы кадры (4n+1) укладывались в лимит 121 (8 с максимум).
const runpodWan22Presets: readonly WorkflowPreset[] = [
	{
		description: "480×832, 4 шага — самый быстрый прогон (lightx2v).",
		group: "quality",
		id: "wan-quality-preview",
		label: "Превью",
		params: { width: 480, height: 832, steps: 4, cfgScale: 1, loraScale: 1 },
	},
	{
		description: "720×1280, 6 шагов — баланс скорости и резкости.",
		group: "quality",
		id: "wan-quality-balanced",
		label: "Баланс",
		params: { width: 720, height: 1280, steps: 6, cfgScale: 1, loraScale: 1 },
	},
	{
		description: "720×1280, 8 шагов — максимум качества под lightx2v.",
		group: "quality",
		id: "wan-quality-high",
		label: "Качество",
		params: { width: 720, height: 1280, steps: 8, cfgScale: 1, loraScale: 1 },
	},
	{
		description: "~3 секунды при 24 fps (72 кадра).",
		group: "duration",
		id: "wan-duration-3s",
		label: "3 сек",
		params: { durationSeconds: 3, fps: 24 },
	},
	{
		description: "~5 секунд при 24 fps (121 кадр).",
		group: "duration",
		id: "wan-duration-5s",
		label: "5 сек",
		params: { durationSeconds: 5, fps: 24 },
	},
	{
		description: "~6 секунд при 20 fps (121 кадр).",
		group: "duration",
		id: "wan-duration-6s",
		label: "6 сек",
		params: { durationSeconds: 6, fps: 20 },
	},
];

const runpodFluxDevParameterFields: readonly WorkflowField[] = [
	{
		description: "Output image width in pixels. Must be divisible by 16.",
		key: "width",
		label: "Width",
		max: 1536,
		min: 256,
		step: 16,
		type: "number",
	},
	{
		description: "Output image height in pixels. Must be divisible by 16.",
		key: "height",
		label: "Height",
		max: 1536,
		min: 256,
		step: 16,
		type: "number",
	},
	{
		description: "Total denoising steps.",
		key: "steps",
		label: "Steps",
		max: 60,
		min: 1,
		step: 1,
		unit: "steps",
		type: "number",
	},
	{
		description: "Flux guidance (distilled CFG). Recommended 2.5–4.0.",
		key: "guidance",
		label: "Guidance",
		max: 20,
		min: 0,
		step: 0.1,
		type: "number",
	},
	{
		description: "Number of images to generate in one batch.",
		key: "numImages",
		label: "Images",
		max: 4,
		min: 1,
		step: 1,
		type: "number",
	},
	{
		description: "Negative prompt to discourage unwanted content.",
		key: "negativePrompt",
		label: "Negative prompt",
		optional: true,
		type: "text",
	},
	{
		description:
			"Pre-provisioned LoRA filename under models/loras on the volume (optional).",
		key: "loraFilename",
		label: "LoRA filename",
		optional: true,
		type: "text",
	},
	{
		description: "Strength of the optional LoRA.",
		key: "loraScale",
		label: "LoRA scale",
		max: 2,
		min: 0,
		step: 0.05,
		type: "number",
	},
	{
		description: "Optional deterministic seed.",
		key: "seed",
		label: "Seed",
		optional: true,
		type: "number",
	},
];

const runpodFluxDetailerParameterFields: readonly WorkflowField[] = [
	{
		description:
			"Detail strength (img2img denoise). Lower keeps the original, higher adds more detail. 0.3–0.5 recommended.",
		key: "denoise",
		label: "Detail strength",
		max: 1,
		min: 0.05,
		step: 0.05,
		type: "number",
	},
	{
		description:
			"Upscale factor applied before the detail pass (1 = keep size, 2 = double resolution).",
		key: "upscaleBy",
		label: "Upscale",
		max: 2,
		min: 1,
		step: 0.1,
		type: "number",
	},
	{
		description: "Total denoising steps for the detail pass.",
		key: "steps",
		label: "Steps",
		max: 60,
		min: 1,
		step: 1,
		unit: "steps",
		type: "number",
	},
	{
		description: "Flux guidance (distilled CFG). Recommended 2.5–4.0.",
		key: "guidance",
		label: "Guidance",
		max: 20,
		min: 0,
		step: 0.1,
		type: "number",
	},
	{
		description: "Negative prompt to discourage unwanted content.",
		key: "negativePrompt",
		label: "Negative prompt",
		optional: true,
		type: "text",
	},
	{
		description: "Optional deterministic seed.",
		key: "seed",
		label: "Seed",
		optional: true,
		type: "number",
	},
];

export const workflowRegistry = {
	"runpod-fooocus-sdxl": {
		baseModel: "sdxl",
		key: "runpod-fooocus-sdxl",
		name: "Fooocus SDXL (RunPod Serverless)",
		description:
			"Fooocus SDXL text-to-image generation on a custom RunPod Serverless endpoint. Supports SDXL LoRA URLs.",
		requiresInputImage: false,
		parameterSchema: runpodFooocusSdxlParamsSchema,
		parameterFields: [
			{
				description:
					"Output image size preset controlling aspect ratio and resolution.",
				key: "imageSize",
				label: "Image size",
				type: "text",
			},
			{
				description: "Number of denoising steps.",
				key: "numInferenceSteps",
				label: "Steps",
				max: 60,
				min: 1,
				step: 1,
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				max: 20,
				min: 0,
				step: 0.1,
				type: "number",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Number of images",
				max: 8,
				min: 1,
				step: 1,
				type: "number",
			},
			{
				description: "Output image format.",
				enumValues: ["jpeg", "png"],
				key: "outputFormat",
				label: "Output format",
				type: "text",
			},
			{
				description: "Negative prompt to discourage unwanted content.",
				key: "negativePrompt",
				label: "Negative prompt",
				optional: true,
				type: "text",
			},
			{
				description:
					"Optional public URL pointing to trained SDXL LoRA weights.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the primary LoRA effect.",
				key: "loraWeight",
				label: "LoRA weight",
				max: 2,
				min: 0,
				step: 0.05,
				type: "number",
			},
			{
				description:
					"Optional second public URL pointing to SDXL LoRA weights.",
				key: "extraLoraUrl",
				kind: "lora-url",
				label: "Extra LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the extra LoRA effect.",
				key: "extraLoraWeight",
				label: "Extra LoRA weight",
				max: 2,
				min: 0,
				step: 0.05,
				type: "number",
			},
			{
				description: "Run Fooocus refiner after the base pass.",
				enumValues: ["true", "false"],
				key: "enableRefiner",
				label: "Refiner",
				type: "text",
			},
			{
				description: "Optional deterministic seed for repeatable outputs.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = runpodFooocusSdxlParamsSchema.parse(params);
			return buildRunpodFooocusSdxlInput({ parsed, prompt });
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"runpod-ltx-2-3-image-to-video": {
		baseModel: "ltx-2-3",
		key: "runpod-ltx-2-3-image-to-video",
		name: "LTX 2.3 I2V (RunPod)",
		description:
			"LTX 2.3 image-to-video на персистентном RunPod ComfyUI-поде. LoRA опциональна — Civitai id (файл civitai-{modelId}-{versionId}.safetensors на volume, см. seed-models) или без LoRA.",
		requiresInputImage: true,
		parameterSchema: runpodLtx23ParamsSchema,
		parameterFields: runpodLtx23ParameterFields,
		presets: runpodLtx23Presets,
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = runpodLtx23ParamsSchema.parse(params);
			return buildRunpodLtx23Input({ inputImageUrl, parsed, prompt });
		},
		extractArtifactUrls: collectRunpodPodVideoUrls,
	},
	"runpod-wan-2-2-image-to-video": {
		baseModel: "wan-2-2",
		key: "runpod-wan-2-2-image-to-video",
		name: "Wan 2.2 I2V (RunPod)",
		description:
			"Wan 2.2 14B image-to-video на персистентном RunPod ComfyUI-поде. Двухэкспертный high/low-noise пайплайн, модели на network volume. LoRA («Wan Pussy» и др.) — loraHighFilename/loraLowFilename на volume или legacy Civitai id.",
		requiresInputImage: true,
		parameterSchema: runpodWan22ParamsSchema,
		parameterFields: runpodWan22ParameterFields,
		presets: runpodWan22Presets,
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = runpodWan22ParamsSchema.parse(params);
			return buildRunpodWan22Input({ inputImageUrl, parsed, prompt });
		},
		extractArtifactUrls: collectRunpodPodVideoUrls,
	},
	"runpod-flux-dev-image": {
		baseModel: "flux",
		key: "runpod-flux-dev-image",
		name: "Flux.1-dev (RunPod)",
		description:
			"Flux.1-dev text-to-image на персистентном RunPod ComfyUI-поде. All-in-one fp8-чекпоинт на network volume, LoRA («Noisify» и др.) — loraFilename на volume. Self-hosted.",
		requiresInputImage: false,
		parameterSchema: runpodFluxDevParamsSchema,
		parameterFields: runpodFluxDevParameterFields,
		buildProviderInput: ({ params, prompt }) => {
			const parsed = runpodFluxDevParamsSchema.parse(params);
			return buildRunpodFluxDevInput({ parsed, prompt });
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"runpod-flux-detailer": {
		baseModel: "flux",
		key: "runpod-flux-detailer",
		name: "Flux Detailer (RunPod)",
		description:
			"Детейлер изображений на Flux.1-dev: апскейл исходника + img2img проход с низким denoise для добавления деталей и резкости. Переиспользует тот же RunPod ComfyUI flux endpoint и fp8-чекпоинт.",
		requiresInputImage: true,
		parameterSchema: runpodFluxDetailerParamsSchema,
		parameterFields: runpodFluxDetailerParameterFields,
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = runpodFluxDetailerParamsSchema.parse(params);
			return buildRunpodFluxDetailerInput({ inputImageUrl, parsed, prompt });
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"runpod-voxcpm-tts": {
		baseModel: "voxcpm-2",
		key: "runpod-voxcpm-tts",
		name: "VoxCPM2 TTS (RunPod)",
		description:
			"Text-to-speech на VoxCPM2 (Apache 2.0, 48kHz, 30 языков) с voice cloning по reference-аудио. Self-hosted RunPod serverless воркер. Текст берётся из prompt.",
		requiresInputImage: false,
		parameterSchema: runpodTtsParamsSchema,
		parameterFields: runpodTtsParameterFields,
		buildProviderInput: ({ params, prompt }) => {
			const parsed = runpodTtsParamsSchema.parse(params);
			return buildRunpodTtsInput({
				parsed,
				prompt,
				workflowKey: RUNPOD_VOXCPM_TTS_KEY,
			});
		},
		extractArtifactUrls: collectRunpodTtsAudioUrls,
	},
	"runpod-higgs-tts": {
		baseModel: "higgs-audio-v3",
		hiddenFromList: true,
		key: "runpod-higgs-tts",
		name: "Higgs Audio v3 TTS (RunPod, experimental)",
		description:
			"Experimental TTS на Higgs Audio v3 4B (100+ языков, inline-теги эмоций/просодии). ВНИМАНИЕ: лицензия Research & Non-Commercial — требует отдельной лицензии Boson AI для коммерческого использования. Gated по RUNPOD_HIGGS_TTS_ENDPOINT_ID.",
		requiresInputImage: false,
		parameterSchema: runpodTtsParamsSchema,
		parameterFields: runpodTtsParameterFields,
		buildProviderInput: ({ params, prompt }) => {
			const parsed = runpodTtsParamsSchema.parse(params);
			return buildRunpodTtsInput({
				parsed,
				prompt,
				workflowKey: RUNPOD_HIGGS_TTS_KEY,
			});
		},
		extractArtifactUrls: collectRunpodTtsAudioUrls,
	},
	// Legacy ключи: оставляем функционирующими, но скрываем из списка — старая
	// архитектура (text-to-video на bootstrap pod) не поддерживается template
	// p4f6rm9tb4, поэтому фактически они мапятся на тот же i2v пайплайн.
	"runpod-ltx-2-3-text-to-video": {
		baseModel: "ltx-2-3",
		hiddenFromList: true,
		key: "runpod-ltx-2-3-text-to-video",
		name: "LTX 2.3 (RunPod Serverless, legacy)",
		description:
			"Legacy LTX 2.3 text-to-video RunPod workflow. Новая архитектура — serverless i2v через runpod-ltx-2-3-image-to-video; ключ оставлен для обратной совместимости existing scenarios.",
		requiresInputImage: true,
		parameterSchema: runpodLtx23ParamsSchema,
		parameterFields: runpodLtx23ParameterFields,
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = runpodLtx23ParamsSchema.parse(params);
			return buildRunpodLtx23Input({ inputImageUrl, parsed, prompt });
		},
		extractArtifactUrls: collectRunpodPodVideoUrls,
	},
	"runpod-ltx-2-3-synth-text-to-video": {
		baseModel: "ltx-2-3",
		hiddenFromList: true,
		key: "runpod-ltx-2-3-synth-text-to-video",
		name: "LTX 2.3 Synth LoRA (RunPod Serverless, legacy)",
		description:
			"Legacy ключ Synth Pussy text-to-video. Скрыт; existing scenarios должны мигрировать на runpod-ltx-2-3-image-to-video с inputImageUrl.",
		requiresInputImage: true,
		parameterSchema: runpodLtx23ParamsSchema,
		parameterFields: runpodLtx23ParameterFields,
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = runpodLtx23ParamsSchema.parse(params);
			return buildRunpodLtx23Input({ inputImageUrl, parsed, prompt });
		},
		extractArtifactUrls: collectRunpodPodVideoUrls,
	},
	"civitai-lustify-olt-sdxl": {
		baseModel: "sdxl",
		key: "civitai-lustify-olt-sdxl",
		name: "Lustify OLT SDXL (Civitai)",
		description:
			"Lustify SDXL OLT (FIXED TEXTURES) text-to-image generation through Civitai's native inference API using model 573152 version 1569593.",
		requiresInputImage: false,
		parameterSchema: civitaiLustifyOltSdxlParamsSchema,
		parameterFields: [
			{
				description: "Output image width in pixels.",
				key: "width",
				label: "Width",
				max: 1536,
				min: 512,
				step: 64,
				type: "number",
			},
			{
				description: "Output image height in pixels.",
				key: "height",
				label: "Height",
				max: 1536,
				min: 512,
				step: 64,
				type: "number",
			},
			{
				description: "Number of denoising steps.",
				key: "steps",
				label: "Steps",
				max: 60,
				min: 1,
				step: 1,
				unit: "steps",
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "cfgScale",
				label: "CFG scale",
				max: 20,
				min: 0,
				step: 0.1,
				type: "number",
			},
			{
				description: "Sampler scheduler used by Civitai.",
				enumValues: [
					"EulerA",
					"Euler",
					"LMS",
					"Heun",
					"DPM2",
					"DPM2A",
					"DPM2SA",
					"DPM2M",
					"DPMSDE",
					"DPMFast",
					"DPMAdaptive",
					"LMSKarras",
					"DPM2Karras",
					"DPM2AKarras",
					"DPM2SAKarras",
					"DPM2MKarras",
					"DPMSDEKarras",
					"DDIM",
					"PLMS",
					"UniPC",
					"LCM",
					"DDPM",
					"DEIS",
				],
				key: "scheduler",
				label: "Scheduler",
				type: "text",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Number of images",
				max: 4,
				min: 1,
				step: 1,
				type: "number",
			},
			{
				description: "CLIP skip value for SDXL generation.",
				key: "clipSkip",
				label: "CLIP skip",
				max: 12,
				min: 1,
				step: 1,
				type: "number",
			},
			{
				description: "Negative prompt to discourage unwanted content.",
				key: "negativePrompt",
				label: "Negative prompt",
				optional: true,
				type: "text",
			},
			{
				description: "Optional deterministic seed for repeatable outputs.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = civitaiLustifyOltSdxlParamsSchema.parse(params);
			return {
				__civitaiModel: CIVITAI_LUSTIFY_OLT_MODEL_URN,
				$type: "textToImage",
				baseModel: "SDXL",
				model: CIVITAI_LUSTIFY_OLT_MODEL_URN,
				params: {
					cfgScale: parsed.cfgScale,
					clipSkip: parsed.clipSkip,
					height: parsed.height,
					negativePrompt: parsed.negativePrompt,
					prompt,
					scheduler: parsed.scheduler,
					steps: parsed.steps,
					width: parsed.width,
					...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
				},
				quantity: parsed.numImages,
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"civitai-ltx-2-3-synth-text-to-video": {
		baseModel: "ltx-2-3",
		key: "civitai-ltx-2-3-synth-text-to-video",
		name: "LTX 2.3 Synth LoRA (Civitai)",
		description:
			"LTX 2.3 text-to-video generation through Civitai's native videoGen API with Civitai LoRA model 2509189 version 2820451 loaded directly by AIR.",
		requiresInputImage: false,
		parameterSchema: civitaiLtx23SynthParamsSchema,
		parameterFields: [
			{
				description: "Output resolution bucket used by Civitai LTX 2.3.",
				enumValues: ["720p", "1080p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Output aspect ratio.",
				enumValues: ["16:9", "3:2", "1:1", "2:3", "9:16"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Civitai LTX 2.3 duration bucket in seconds.",
				enumValues: CIVITAI_LTX23_DURATION_OPTIONS,
				key: "duration",
				label: "Duration",
				unit: "s",
				type: "text",
			},
			{
				description: "Number of denoising steps for the LTX 2.3 dev model.",
				key: "steps",
				label: "Steps",
				max: 50,
				min: 10,
				step: 1,
				unit: "steps",
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "CFG scale",
				max: 10,
				min: 1,
				step: 0.5,
				type: "number",
			},
			{
				description: "Civitai model page or model-version URL for the LoRA.",
				key: "loraSourceUrl",
				label: "Civitai LoRA URL",
				type: "text",
			},
			{
				description: "Civitai AIR reference used directly by videoGen.",
				key: "loraAir",
				label: "LoRA AIR",
				type: "text",
			},
			{
				description: "Civitai model id for the selected LoRA.",
				key: "loraModelId",
				label: "LoRA model id",
				type: "number",
			},
			{
				description: "Civitai model version id for the selected LoRA.",
				key: "loraVersionId",
				label: "LoRA version id",
				type: "number",
			},
			{
				description: "Display name of the selected Civitai LoRA.",
				key: "loraName",
				label: "LoRA name",
				type: "text",
			},
			{
				description: "Detected Civitai base model compatibility.",
				key: "loraBaseModel",
				label: "LoRA base model",
				type: "text",
			},
			{
				description: "Whether Civitai marks this LoRA as generation-capable.",
				enumValues: ["true", "false"],
				key: "loraSupportsGeneration",
				label: "Civitai generation",
				type: "text",
			},
			{
				description: "Comma-separated Civitai trigger words for this LoRA.",
				key: "loraTriggerWords",
				label: "Trigger words",
				optional: true,
				type: "text",
			},
			{
				description: "Strength of the selected Civitai LoRA.",
				key: "loraStrength",
				label: "LoRA strength",
				max: 2,
				min: 0,
				step: 0.05,
				type: "number",
			},
			{
				description: "Generate synchronized audio with the video.",
				enumValues: ["true", "false"],
				key: "generateAudio",
				label: "Audio",
				type: "text",
			},
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				optional: true,
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = civitaiLtx23SynthParamsSchema.parse(params);
			return buildCivitaiLtx23SynthInput({
				operation: "createVideo",
				parsed,
				prompt,
			});
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"civitai-ltx-2-3-synth-image-to-video": {
		baseModel: "ltx-2-3",
		key: "civitai-ltx-2-3-synth-image-to-video",
		name: "LTX 2.3 Synth LoRA I2V (Civitai)",
		description:
			"LTX 2.3 first/last-frame image-to-video generation through Civitai's native videoGen API with Civitai LoRA model 2509189 version 2820451 loaded directly by AIR.",
		requiresInputImage: true,
		parameterSchema: civitaiLtx23SynthImageToVideoParamsSchema,
		parameterFields: [
			{
				description:
					"Optional ending frame URL for generating a transition video.",
				key: "endImageUrl",
				kind: "image-url",
				label: "End image URL",
				optional: true,
				type: "text",
			},
			{
				description: "Output resolution bucket used by Civitai LTX 2.3.",
				enumValues: ["720p", "1080p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Output aspect ratio.",
				enumValues: ["16:9", "3:2", "1:1", "2:3", "9:16"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Civitai LTX 2.3 duration bucket in seconds.",
				enumValues: CIVITAI_LTX23_DURATION_OPTIONS,
				key: "duration",
				label: "Duration",
				unit: "s",
				type: "text",
			},
			{
				description: "Number of denoising steps for the LTX 2.3 dev model.",
				key: "steps",
				label: "Steps",
				max: 50,
				min: 10,
				step: 1,
				unit: "steps",
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "CFG scale",
				max: 10,
				min: 1,
				step: 0.5,
				type: "number",
			},
			{
				description: "Civitai model page or model-version URL for the LoRA.",
				key: "loraSourceUrl",
				label: "Civitai LoRA URL",
				type: "text",
			},
			{
				description: "Civitai AIR reference used directly by videoGen.",
				key: "loraAir",
				label: "LoRA AIR",
				type: "text",
			},
			{
				description: "Civitai model id for the selected LoRA.",
				key: "loraModelId",
				label: "LoRA model id",
				type: "number",
			},
			{
				description: "Civitai model version id for the selected LoRA.",
				key: "loraVersionId",
				label: "LoRA version id",
				type: "number",
			},
			{
				description: "Display name of the selected Civitai LoRA.",
				key: "loraName",
				label: "LoRA name",
				type: "text",
			},
			{
				description: "Detected Civitai base model compatibility.",
				key: "loraBaseModel",
				label: "LoRA base model",
				type: "text",
			},
			{
				description: "Whether Civitai marks this LoRA as generation-capable.",
				enumValues: ["true", "false"],
				key: "loraSupportsGeneration",
				label: "Civitai generation",
				type: "text",
			},
			{
				description: "Comma-separated Civitai trigger words for this LoRA.",
				key: "loraTriggerWords",
				label: "Trigger words",
				optional: true,
				type: "text",
			},
			{
				description: "Strength of the selected Civitai LoRA.",
				key: "loraStrength",
				label: "LoRA strength",
				max: 2,
				min: 0,
				step: 0.05,
				type: "number",
			},
			{
				description: "Generate synchronized audio with the video.",
				enumValues: ["true", "false"],
				key: "generateAudio",
				label: "Audio",
				type: "text",
			},
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				optional: true,
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = civitaiLtx23SynthImageToVideoParamsSchema.parse(params);
			return buildCivitaiLtx23SynthInput({
				firstFrame: inputImageUrl,
				lastFrame: parsed.endImageUrl,
				operation: "firstLastFrameToVideo",
				parsed,
				prompt,
			});
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"civitai-ltx-2-3-flf-image-to-video": {
		baseModel: "ltx-2-3",
		key: "civitai-ltx-2-3-flf-image-to-video",
		name: "LTX 2.3 First/Last Frame I2V (Civitai)",
		description:
			"LTX 2.3 first/last-frame image-to-video on Civitai's base engine (no LoRA). When no end frame is supplied the start frame is reused as the end frame, producing a seamless loop with no crossfade. Designed for clean SFW looping clips like reactive avatars.",
		requiresInputImage: true,
		parameterSchema: civitaiLtx23FlfParamsSchema,
		parameterFields: [
			{
				description:
					"Optional ending frame URL. Leave empty to reuse the start frame and produce a seamless loop.",
				key: "endImageUrl",
				kind: "image-url",
				label: "End image URL",
				optional: true,
				type: "text",
			},
			{
				description: "Output resolution bucket used by Civitai LTX 2.3.",
				enumValues: ["720p", "1080p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Output aspect ratio (portrait by default for avatars).",
				enumValues: ["16:9", "3:2", "1:1", "2:3", "9:16"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Civitai LTX 2.3 duration bucket in seconds.",
				enumValues: CIVITAI_LTX23_DURATION_OPTIONS,
				key: "duration",
				label: "Duration",
				unit: "s",
				type: "text",
			},
			{
				description: "Number of denoising steps for the LTX 2.3 dev model.",
				key: "steps",
				label: "Steps",
				max: 50,
				min: 10,
				step: 1,
				unit: "steps",
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "CFG scale",
				max: 10,
				min: 1,
				step: 0.5,
				type: "number",
			},
			{
				description: "Generate synchronized audio with the video.",
				enumValues: ["true", "false"],
				key: "generateAudio",
				label: "Audio",
				type: "text",
			},
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				optional: true,
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = civitaiLtx23FlfParamsSchema.parse(params);
			return buildCivitaiLtx23FlfInput({
				firstFrame: inputImageUrl,
				lastFrame: parsed.endImageUrl ?? inputImageUrl,
				parsed,
				prompt,
			});
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"replicate-fooocus-sdxl": {
		baseModel: "sdxl",
		key: "replicate-fooocus-sdxl",
		name: "Fooocus SDXL (Replicate)",
		description:
			"Fooocus SDXL text-to-image generation on Replicate via mrhan1993/fooocus-api. Supports SDXL LoRA URLs.",
		requiresInputImage: false,
		parameterSchema: replicateFooocusSdxlParamsSchema,
		parameterFields: [
			{
				description:
					"Output image size preset controlling aspect ratio and resolution.",
				key: "imageSize",
				label: "Image size",
				type: "text",
			},
			{
				description: "Fooocus performance preset.",
				enumValues: ["Speed", "Quality", "Extreme Speed"],
				key: "performanceSelection",
				label: "Performance",
				type: "text",
			},
			{
				description:
					"Comma-separated Fooocus styles applied during generation.",
				key: "styleSelections",
				label: "Styles",
				type: "text",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Number of images",
				max: 8,
				min: 1,
				step: 1,
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				max: 30,
				min: 1,
				step: 0.1,
				type: "number",
			},
			{
				description: "Negative prompt to discourage unwanted content.",
				key: "negativePrompt",
				label: "Negative prompt",
				optional: true,
				type: "text",
			},
			{
				description:
					"Optional public URL pointing to trained SDXL LoRA weights.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the primary LoRA effect.",
				key: "loraWeight",
				label: "LoRA weight",
				max: 2,
				min: 0,
				step: 0.05,
				type: "number",
			},
			{
				description:
					"Optional second public URL pointing to SDXL LoRA weights.",
				key: "extraLoraUrl",
				kind: "lora-url",
				label: "Extra LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the extra LoRA effect.",
				key: "extraLoraWeight",
				label: "Extra LoRA weight",
				max: 2,
				min: 0,
				step: 0.05,
				type: "number",
			},
			{
				description: "Use Fooocus default LoRA set in addition to custom URLs.",
				enumValues: ["true", "false"],
				key: "useDefaultLoras",
				label: "Default LoRAs",
				type: "text",
			},
			{
				description: "Fooocus sharpness parameter.",
				key: "sharpness",
				label: "Sharpness",
				max: 30,
				min: 0,
				step: 0.1,
				type: "number",
			},
			{
				description: "Refiner switch threshold.",
				key: "refinerSwitch",
				label: "Refiner switch",
				max: 1,
				min: 0.1,
				step: 0.05,
				type: "number",
			},
			{
				description: "Optional deterministic seed for repeatable outputs.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = replicateFooocusSdxlParamsSchema.parse(params);
			const loras = buildRunpodFooocusLoras(parsed);
			return {
				__replicateVersion: REPLICATE_FOOOCUS_API_VERSION,
				prompt,
				negative_prompt: parsed.negativePrompt,
				style_selections: parsed.styleSelections,
				performance_selection: parsed.performanceSelection,
				aspect_ratios_selection: FOOOCUS_ASPECT_RATIOS[parsed.imageSize],
				image_number: parsed.numImages,
				image_seed: parsed.seed ?? -1,
				use_default_loras: parsed.useDefaultLoras,
				loras_custom_urls: buildRunpodFooocusLoraUrls(loras),
				sharpness: parsed.sharpness,
				guidance_scale: parsed.guidanceScale,
				refiner_switch: parsed.refinerSwitch,
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"replicate-flux-dev-lora": {
		baseModel: "flux",
		key: "replicate-flux-dev-lora",
		name: "Flux Dev LoRA (Replicate)",
		description:
			"FLUX.1 [dev] text-to-image on Replicate via black-forest-labs/flux-dev-lora. Same base model as fal-flux-dev with `disable_safety_checker: true` actually honoured, so NSFW LoRAs return real images instead of fal's blackout placeholder.",
		requiresInputImage: false,
		parameterSchema: replicateFluxDevLoraParamsSchema,
		parameterFields: [
			{
				description:
					"Output image size preset controlling aspect ratio. Mapped to Replicate's `aspect_ratio` (e.g. portrait_16_9 → 9:16).",
				key: "imageSize",
				label: "Image size",
				type: "text",
			},
			{
				description: "Number of denoising steps (28-50 recommended).",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
			},
			{
				description: "Number of images per request.",
				key: "numImages",
				label: "Number of images",
				type: "number",
			},
			{
				description:
					"Optional public URL pointing to FLUX-compatible LoRA weights. Replicate accepts arbitrary .safetensors URLs without extra auth.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				type: "text",
			},
			{
				description:
					"Strength of the primary LoRA. Sane range 0-1. With go_fast=true Replicate auto-multiplies this by 1.5.",
				key: "loraScale",
				label: "LoRA scale",
				type: "number",
			},
			{
				description: "Optional second FLUX-compatible LoRA URL.",
				key: "extraLoraUrl",
				kind: "lora-url",
				label: "Extra LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the extra LoRA when provided.",
				key: "extraLoraScale",
				label: "Extra LoRA scale",
				type: "number",
			},
			{
				description: "Approximate output size in megapixels.",
				enumValues: ["1", "0.25"],
				key: "megapixels",
				label: "Megapixels",
				type: "text",
			},
			{
				description:
					"Run fp8-quantized fast path. Faster but applies a 1.5x lora_scale multiplier and outputs are non-deterministic even with a seed.",
				enumValues: ["true", "false"],
				key: "goFast",
				label: "Go fast (fp8)",
				type: "text",
			},
			{
				description: "Output image format.",
				enumValues: ["jpg", "png", "webp"],
				key: "outputFormat",
				label: "Output format",
				type: "text",
			},
			{
				description: "Optional deterministic seed (ignored in go_fast mode).",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = replicateFluxDevLoraParamsSchema.parse(params);
			const aspectRatio =
				REPLICATE_FLUX_DEV_LORA_ASPECT_RATIO[parsed.imageSize];
			return {
				__replicateVersion: REPLICATE_FLUX_DEV_LORA_VERSION,
				prompt,
				aspect_ratio: aspectRatio,
				num_inference_steps: parsed.numInferenceSteps,
				guidance: parsed.guidanceScale,
				num_outputs: parsed.numImages,
				go_fast: parsed.goFast,
				disable_safety_checker: parsed.disableSafetyChecker,
				output_format: parsed.outputFormat,
				megapixels: parsed.megapixels,
				...(parsed.loraUrl
					? {
							lora_weights: parsed.loraUrl,
							lora_scale: parsed.loraScale,
						}
					: {}),
				...(parsed.extraLoraUrl
					? {
							extra_lora: parsed.extraLoraUrl,
							extra_lora_scale: parsed.extraLoraScale,
						}
					: {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"replicate-wan-2-2-fast-text-to-video": {
		baseModel: "wan-2-2",
		key: "replicate-wan-2-2-fast-text-to-video",
		name: "Wan 2.2 Fast T2V (Replicate)",
		description:
			"Fast text-to-video generation using wan-video/wan-2.2-t2v-fast on Replicate. Optionally accepts paired high/low LoRA URLs.",
		requiresInputImage: false,
		parameterSchema: replicateWan22FastTextToVideoParamsSchema,
		parameterFields: [
			{
				description: "Output video aspect ratio.",
				enumValues: ["16:9", "9:16"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Output video resolution.",
				enumValues: ["480p", "720p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Number of generated frames.",
				key: "numFrames",
				label: "Frames",
				max: 121,
				min: 81,
				step: 1,
				type: "number",
				unit: "frames",
			},
			{
				description: "Source frames per second.",
				key: "framesPerSecond",
				label: "FPS",
				max: 30,
				min: 5,
				step: 1,
				type: "number",
				unit: "fps",
			},
			{
				description: "Interpolate generated video to 30 FPS.",
				enumValues: ["true", "false"],
				key: "interpolateOutput",
				label: "Interpolate",
				type: "text",
			},
			{
				description: "Translate and optimize prompt before generation.",
				enumValues: ["true", "false"],
				key: "optimizePrompt",
				label: "Optimize prompt",
				type: "text",
			},
			{
				description: "Use Replicate's fast execution path.",
				enumValues: ["true", "false"],
				key: "goFast",
				label: "Go fast",
				type: "text",
			},
			{
				description: "Sample shift factor.",
				key: "sampleShift",
				label: "Sample shift",
				max: 20,
				min: 1,
				step: 0.1,
				type: "number",
			},
			...wanLoraParameterFields,
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = replicateWan22FastTextToVideoParamsSchema.parse(params);
			return {
				__replicateVersion: REPLICATE_WAN_22_T2V_FAST_VERSION,
				prompt,
				aspect_ratio: parsed.aspectRatio,
				optimize_prompt: parsed.optimizePrompt,
				...buildReplicateWanFastBaseInput(parsed),
				...buildReplicateWanLoraInput(parsed),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"replicate-wan-2-2-fast-image-to-video": {
		baseModel: "wan-2-2",
		key: "replicate-wan-2-2-fast-image-to-video",
		name: "Wan 2.2 Fast I2V (Replicate)",
		description:
			"Fast image-to-video generation using wan-video/wan-2.2-i2v-fast on Replicate. Supports optional last frame and paired high/low LoRA URLs.",
		requiresInputImage: true,
		parameterSchema: replicateWan22FastImageToVideoParamsSchema,
		parameterFields: [
			{
				description: "Optional last image for smoother frame transitions.",
				key: "endImageUrl",
				label: "End image URL",
				optional: true,
				type: "text",
			},
			{
				description: "Output video resolution.",
				enumValues: ["480p", "720p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Number of generated frames.",
				key: "numFrames",
				label: "Frames",
				max: 121,
				min: 81,
				step: 1,
				type: "number",
				unit: "frames",
			},
			{
				description: "Source frames per second.",
				key: "framesPerSecond",
				label: "FPS",
				max: 30,
				min: 5,
				step: 1,
				type: "number",
				unit: "fps",
			},
			{
				description: "Interpolate generated video to 30 FPS.",
				enumValues: ["true", "false"],
				key: "interpolateOutput",
				label: "Interpolate",
				type: "text",
			},
			{
				description: "Use Replicate's fast execution path.",
				enumValues: ["true", "false"],
				key: "goFast",
				label: "Go fast",
				type: "text",
			},
			{
				description: "Sample shift factor.",
				key: "sampleShift",
				label: "Sample shift",
				max: 20,
				min: 1,
				step: 0.1,
				type: "number",
			},
			...wanLoraParameterFields,
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = replicateWan22FastImageToVideoParamsSchema.parse(params);
			return {
				__replicateVersion: REPLICATE_WAN_22_I2V_FAST_VERSION,
				prompt,
				image: inputImageUrl,
				...(parsed.endImageUrl ? { last_image: parsed.endImageUrl } : {}),
				...buildReplicateWanFastBaseInput(parsed),
				...buildReplicateWanLoraInput(parsed),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
} satisfies Record<string, WorkflowTypes.WorkflowDefinition>;

export type WorkflowKey = keyof typeof workflowRegistry;

export function getWorkflowExpectedDurationMs(
	workflowKey: string
): number | null {
	const fromMap = WORKFLOW_EXPECTED_DURATION_MS[workflowKey];
	if (fromMap !== undefined) {
		return fromMap;
	}
	const fromRegistry = workflowRegistry[workflowKey as WorkflowKey];
	const fromDefinition = (
		fromRegistry as { expectedDurationMs?: number } | undefined
	)?.expectedDurationMs;
	return fromDefinition ?? null;
}

const SUPPORTED_IMAGE_SIZES = [
	"square_hd",
	"square",
	"portrait_4_3",
	"portrait_16_9",
	"landscape_4_3",
	"landscape_16_9",
] as const;

const SUPPORTED_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;

function enrichField(field: WorkflowField): WorkflowField {
	if (field.enumValues || field.min !== undefined || field.max !== undefined) {
		return field;
	}

	switch (field.key) {
		case "imageSize": {
			return { ...field, enumValues: SUPPORTED_IMAGE_SIZES };
		}
		case "outputFormat":
			return { ...field, enumValues: SUPPORTED_OUTPUT_FORMATS };
		case "numInferenceSteps": {
			return { ...field, min: 1, max: 50, step: 1, unit: "steps" };
		}
		case "guidanceScale":
		case "guidanceScale2":
			return { ...field, min: 1, max: 20, step: 0.1 };
		case "shift":
			return { ...field, min: 1, max: 10, step: 0.1 };
		case "numFrames": {
			return { ...field, min: 17, max: 161, step: 1, unit: "frames" };
		}
		case "framesPerSecond":
			return { ...field, min: 4, max: 60, step: 1, unit: "fps" };
		case "fps":
			return { ...field, min: 8, max: 60, step: 1, unit: "fps" };
		case "numImages":
			return { ...field, min: 1, max: 4, step: 1 };
		case "loraScale":
		case "loraWeight":
		case "loraScaleHigh":
		case "loraScaleLow":
			return { ...field, min: 0, max: 2, step: 0.05 };
		case "extraLoraWeight":
			return { ...field, min: 0, max: 2, step: 0.05, optional: true };
		case "extraLoraUrl":
			return { ...field, optional: true };
		case "loraUrl":
		case "loraUrlHigh":
		case "loraUrlLow": {
			// Every workflow that exposes a `loraUrl*` field now runs on the LoRA
			// variant of its provider endpoint, with an empty `loras` array sent
			// when no URL is provided. We mark the field optional so the UI hides
			// the required indicator and surfaces it as a "leave empty to skip"
			// affordance. Wan 2.2 exposes paired high/low slots and follows the
			// same convention.
			return { ...field, optional: true };
		}
		case "endImageUrl":
			return { ...field, kind: "image-url", optional: true };
		case "seed":
			return { ...field, min: 0, optional: true };
		case "strength":
			return { ...field, min: 0, max: 1, step: 0.01 };
		default:
			return field;
	}
}

export function listWorkflows(): WorkflowSummary[] {
	const workflows: WorkflowTypes.WorkflowDefinition[] =
		Object.values(workflowRegistry);
	return workflows
		.filter((workflow) => !workflow.hiddenFromList)
		.map((workflow) => {
			const result = workflow.parameterSchema.safeParse({});
			return {
				baseModel: workflow.baseModel,
				defaults: (result.success ? result.data : {}) as Record<
					string,
					unknown
				>,
				description: workflow.description,
				key: workflow.key,
				name: workflow.name,
				parameterFields: workflow.parameterFields.map((field) =>
					enrichField(field)
				),
				...(workflow.presets ? { presets: workflow.presets } : {}),
				requiresInputImage: workflow.requiresInputImage,
			};
		});
}

export function getWorkflowDefinition(workflowKey: string) {
	return workflowRegistry[workflowKey as WorkflowKey] ?? null;
}
