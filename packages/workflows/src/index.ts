import type {
	WorkflowField,
	WorkflowSummary,
} from "@generator/contracts/generator";
import { z } from "zod";

import { falImageEditWorkflowRegistry } from "./fal-image-edit-models";
import { collectArtifactUrls, collectFalImageUrls } from "./fal-output";
import type * as WorkflowTypes from "./workflow-types";

export type { WorkflowDefinition } from "./workflow-types";

const falFlux2TurboParamsSchema = z.object({
	guidanceScale: z.number().min(1).max(20).default(2.5),
	imageSize: z
		.union([
			z.enum([
				"square_hd",
				"square",
				"portrait_4_3",
				"portrait_16_9",
				"landscape_4_3",
				"landscape_16_9",
			]),
			z.object({
				width: z.number().int().min(512).max(2048),
				height: z.number().int().min(512).max(2048),
			}),
		])
		.default("portrait_4_3"),
	numImages: z.number().int().min(1).max(4).default(1),
	enableSafetyChecker: z.boolean().default(false),
	enablePromptExpansion: z.boolean().default(false),
	outputFormat: z.enum(["png", "jpeg", "webp"]).default("png"),
	seed: z.number().int().nonnegative().optional(),
});

const falFluxSchnellParamsSchema = z.object({
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
	numInferenceSteps: z.number().int().min(1).max(12).default(4),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	// fal's input moderation is very strict on portraits / person LoRAs;
	// default off so studio runs match our other fal workflows. Callers can
	// opt in per-execution.
	enableSafetyChecker: z.boolean().default(false),
});

const optionalUrlParamSchema = z.preprocess(
	(value) =>
		typeof value === "string" && value.trim() === "" ? undefined : value,
	z.string().url().optional()
);

const FOOOCUS_BASE_MODEL_NAME = "juggernautXL_version6Rundiffusion.safetensors";
const FOOOCUS_REFINER_MODEL_NAME = "sd_xl_refiner_1.0_0.9vae.safetensors";
const FOOOCUS_DISABLED_MODEL_NAME = "None";
const FOOOCUS_ASPECT_RATIOS = {
	landscape_4_3: "1152*896",
	landscape_16_9: "1344*768",
	portrait_4_3: "896*1152",
	portrait_16_9: "768*1344",
	square: "1024*1024",
	square_hd: "1024*1024",
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

const falFastSdxlParamsSchema = z.object({
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
	numInferenceSteps: z.number().int().min(1).max(50).default(25),
	guidanceScale: z.number().min(0).max(20).default(7.5),
	numImages: z.number().int().min(1).max(8).default(1),
	negativePrompt: z.string().default(""),
	outputFormat: z.enum(["jpeg", "png"]).default("jpeg"),
	enablePromptExpansion: z.boolean().default(false),
	enableSafetyChecker: z.boolean().default(false),
	seed: z.number().int().nonnegative().optional(),
	loraUrl: optionalUrlParamSchema,
	loraScale: z.number().min(0).max(1).default(1),
});

const falFastFooocusSdxlParamsSchema = z.object({
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
	numInferenceSteps: z.number().int().min(1).max(24).default(8),
	guidanceScale: z.number().min(0).max(20).default(2),
	numImages: z.number().int().min(1).max(8).default(1),
	negativePrompt: z.string().default(""),
	outputFormat: z.enum(["jpeg", "png"]).default("jpeg"),
	enablePromptExpansion: z.boolean().default(false),
	enableRefiner: booleanParamSchema(true),
	seed: z.number().int().nonnegative().optional(),
	embeddingUrl: optionalUrlParamSchema,
	embeddingTokens: z.string().default(""),
});

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

// Flux Dev always targets the `/flux-lora` endpoint — LoRA is optional and we
// send `loras: []` when no URL is provided. The LoRA endpoint is a strict
// superset of the base `flux/dev` endpoint, so this avoids maintaining two
// near-identical workflows for "with LoRA" / "without LoRA".
const falFluxDevParamsSchema = z.object({
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
	// fal's input moderation is very strict on portraits / person LoRAs;
	// default off so studio runs match our other fal workflows. Callers can
	// opt in per-execution.
	enableSafetyChecker: z.boolean().default(false),
	loraUrl: optionalUrlParamSchema,
	loraScale: z.number().min(0).max(2).default(1),
});

// Z-Image Turbo always targets the `/turbo/lora` endpoint — LoRA is optional.
// We keep the dual-LoRA shape (primary + extra) the LoRA endpoint exposes so
// that scenarios can stack styles without giving up the base T2I flow.
const falZimageTurboParamsSchema = z.object({
	imageSize: z
		.enum([
			"square_hd",
			"square",
			"landscape_4_3",
			"landscape_16_9",
			"portrait_4_3",
			"portrait_16_9",
		])
		.default("portrait_4_3"),
	numInferenceSteps: z.number().int().min(1).max(20).default(8),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	enableSafetyChecker: z.boolean().default(false),
	outputFormat: z.enum(["png", "jpeg", "webp"]).default("png"),
	loraUrl: optionalUrlParamSchema,
	loraWeight: z.number().min(0).max(2).default(0.8),
	extraLoraUrl: optionalUrlParamSchema,
	extraLoraWeight: z.number().min(0).max(2).default(0.05),
});

const falZimageTurboImageToImageParamsSchema =
	falZimageTurboParamsSchema.extend({
		imageSize: z
			.enum([
				"auto",
				"square_hd",
				"square",
				"landscape_4_3",
				"landscape_16_9",
				"portrait_4_3",
				"portrait_16_9",
			])
			.default("auto"),
		numInferenceSteps: z.number().int().min(1).max(8).default(8),
		strength: z.number().min(0).max(1).default(0.95),
	});

// Wan 2.2 always targets the `/lora` endpoint — LoRA is optional and we send
// `loras: []` when no URL is provided. The `/lora` endpoint is a strict
// superset of the base endpoint, so this avoids maintaining two near-identical
// workflows for "with LoRA" / "without LoRA".
//
// Wan 2.2 A14B is a dual-expert model (high-noise + low-noise transformer);
// LoRAs are typically trained as a pair and we expose two slots — `loraUrlHigh`
// and `loraUrlLow` — so each can be loaded into the matching transformer via
// fal's `transformer: "high" | "low"` field on each LoRA entry.
const falWan22TextToVideoParamsSchema = z.object({
	negativePrompt: z.string().default(""),
	numFrames: z.number().int().min(17).max(161).default(81),
	framesPerSecond: z.number().int().min(4).max(60).default(16),
	seed: z.number().int().nonnegative().optional(),
	resolution: z.enum(["480p", "580p", "720p"]).default("720p"),
	aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
	numInferenceSteps: z.number().int().min(1).max(50).default(27),
	// fal's input moderation is very strict on portraits / person LoRAs;
	// default off so studio runs match our other fal workflows (LTX/Flux).
	// Callers can opt in per-execution.
	enableSafetyChecker: z.boolean().default(false),
	enableOutputSafetyChecker: z.boolean().default(false),
	enablePromptExpansion: z.boolean().default(false),
	acceleration: z.enum(["none", "regular"]).default("regular"),
	guidanceScale: z.number().min(0).max(20).default(3.5),
	guidanceScale2: z.number().min(0).max(20).default(4),
	shift: z.number().min(1).max(10).default(5),
	interpolatorModel: z.enum(["none", "film", "rife"]).default("film"),
	numInterpolatedFrames: z.number().int().min(0).max(4).default(1),
	adjustFpsForInterpolation: z.boolean().default(true),
	videoQuality: z.enum(["low", "medium", "high", "maximum"]).default("high"),
	videoWriteMode: z.enum(["fast", "balanced", "small"]).default("balanced"),
	loraUrlHigh: optionalUrlParamSchema,
	loraScaleHigh: z.number().min(0).max(2).default(1),
	loraUrlLow: optionalUrlParamSchema,
	loraScaleLow: z.number().min(0).max(2).default(1),
});

const falWan22ImageToVideoParamsSchema = falWan22TextToVideoParamsSchema.extend(
	{
		aspectRatio: z.enum(["auto", "16:9", "9:16", "1:1"]).default("auto"),
		guidanceScale2: z.number().min(0).max(20).default(3.5),
		endImageUrl: optionalUrlParamSchema,
	}
);

// fal-ai/wan/v2.7/image-to-video — без LoRA-слота; отдельная схема от Wan 2.2.
const falWan27ImageToVideoParamsSchema = z.object({
	negativePrompt: z.string().max(500).default(""),
	resolution: z.enum(["720p", "1080p"]).default("1080p"),
	duration: z.number().int().min(2).max(15).default(5),
	enablePromptExpansion: z.boolean().default(false),
	enableSafetyChecker: z.boolean().default(false),
	seed: z.number().int().min(0).max(2_147_483_647).optional(),
	endImageUrl: optionalUrlParamSchema,
	audioUrl: optionalUrlParamSchema,
});

// fal-ai/bytedance/seedance/v1.5/pro/image-to-video
const falSeedance15ProImageToVideoParamsSchema = z.object({
	aspectRatio: z
		.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"])
		.default("16:9"),
	resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
	duration: z.number().int().min(4).max(12).default(5),
	cameraFixed: z.boolean().default(false),
	enableSafetyChecker: z.boolean().default(false),
	generateAudio: z.boolean().default(true),
	/** fal: use -1 for random; omit to let the API choose. */
	seed: z.number().int().optional(),
	endImageUrl: optionalUrlParamSchema,
});

interface WanLoraEntry {
	path: string;
	scale: number;
	transformer: "high" | "low";
}

function buildWanLoras(parsed: {
	loraScaleHigh: number;
	loraScaleLow: number;
	loraUrlHigh?: string;
	loraUrlLow?: string;
}): WanLoraEntry[] {
	const loras: WanLoraEntry[] = [];
	if (parsed.loraUrlHigh) {
		loras.push({
			path: parsed.loraUrlHigh,
			scale: parsed.loraScaleHigh,
			transformer: "high",
		});
	}
	if (parsed.loraUrlLow) {
		loras.push({
			path: parsed.loraUrlLow,
			scale: parsed.loraScaleLow,
			transformer: "low",
		});
	}
	return loras;
}

function buildFooocusEmbeddings(parsed: {
	embeddingTokens: string;
	embeddingUrl?: string;
}): Array<{ path: string; tokens?: string[] }> {
	if (!parsed.embeddingUrl) {
		return [];
	}
	const tokens = parsed.embeddingTokens
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	return [
		{
			path: parsed.embeddingUrl,
			...(tokens.length > 0 ? { tokens } : {}),
		},
	];
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

// LTX-2.3 22B has dedicated `/lora` submodels for both text/image-to-video that
// accept a required `loras: LoRAInput[]` array (path + scale). These submodels
// work without a real LoRA too — fal's example payload uses `path: ""`. We keep
// the workflow keys as `fal-ltx-2-3-*` for backwards compatibility with existing
// studio scenarios. The 22B schema uses CFG/STG/rescaling/modality knobs instead
// of a single `guidance_scale`, and supports `scheduler`/`gradient_estimation_gamma`/
// `distill_lora_*`. We expose only the most useful knobs in the UI and rely on
// fal defaults for the rest.
const falLtx23TextToVideoParamsSchema = z.object({
	negativePrompt: z
		.string()
		.default(
			"news broadcast, 3d animation, computer graphics, pc game, console game, video game, cartoon, childish, watermark, logo, text, on screen text, subtitles, titles, signature, slowmo, static"
		),
	numFrames: z.number().int().min(17).max(257).default(121),
	videoSize: z
		.enum([
			"square_hd",
			"square",
			"portrait_4_3",
			"portrait_16_9",
			"landscape_4_3",
			"landscape_16_9",
		])
		.default("landscape_16_9"),
	fps: z.number().int().min(8).max(60).default(24),
	numInferenceSteps: z.number().int().min(1).max(60).default(40),
	videoCfgScale: z.number().min(1).max(20).default(3),
	generateAudio: z.boolean().default(true),
	useMultiscale: z.boolean().default(true),
	enablePromptExpansion: z.boolean().default(false),
	// fal's input moderation is very strict on portraits / person LoRAs; default off
	// so studio runs match our other fal workflows (Flux/Wan). Callers can opt in.
	enableSafetyChecker: z.boolean().default(false),
	seed: z.number().int().nonnegative().optional(),
	loraUrl: optionalUrlParamSchema,
	loraScale: z.number().min(0).max(2).default(1),
});

const falLtx23ImageToVideoParamsSchema = falLtx23TextToVideoParamsSchema.extend(
	{
		videoSize: z
			.enum([
				"auto",
				"square_hd",
				"square",
				"portrait_4_3",
				"portrait_16_9",
				"landscape_4_3",
				"landscape_16_9",
			])
			.default("auto"),
		endImageUrl: optionalUrlParamSchema,
	}
);

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
	"fal-flux-schnell": 8 * SECOND,
	"fal-flux-dev": 25 * SECOND,
	"fal-flux2-turbo": 12 * SECOND,
	"fal-fast-sdxl": 10 * SECOND,
	"fal-fast-fooocus-sdxl": 10 * SECOND,
	"runpod-fooocus-sdxl": 90 * SECOND,
	"fal-zimage-turbo": 10 * SECOND,
	"fal-zimage-turbo-image-to-image": 15 * SECOND,
	// queue ~10s + inference ~75-90s (5s 720p video)
	"fal-wan-2-2-text-to-video": 90 * SECOND,
	"fal-wan-2-2-image-to-video": 90 * SECOND,
	"fal-wan-2-7-image-to-video": 90 * SECOND,
	"fal-seedance-1-5-pro-image-to-video": 90 * SECOND,
	// ltx-2-pro генерирует медленнее wan'а; уточнить по живым трейсам
	"fal-ltx-2-3-text-to-video": 2 * MINUTE,
	"fal-ltx-2-3-image-to-video": 2 * MINUTE,
};

export const workflowRegistry = {
	"fal-flux-schnell": {
		baseModel: "flux",
		key: "fal-flux-schnell",
		name: "Flux Schnell",
		description:
			"Fast text-to-image generation using FLUX.1-schnell with optimized 4-step inference.",
		requiresInputImage: false,
		parameterSchema: falFluxSchnellParamsSchema,
		parameterFields: [
			{
				description:
					"Output image size preset controlling aspect ratio and resolution.",
				key: "imageSize",
				label: "Image size",
				type: "text",
			},
			{
				description: "Number of denoising steps (1-12 for schnell).",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Number of images",
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
			const parsed = falFluxSchnellParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/flux/schnell",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-fast-sdxl": {
		baseModel: "sdxl",
		key: "fal-fast-sdxl",
		name: "Fast SDXL",
		description:
			"Fast Stable Diffusion XL text-to-image generation on fal.ai. Optionally accepts a LoRA URL to apply custom style weights.",
		requiresInputImage: false,
		parameterSchema: falFastSdxlParamsSchema,
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
					"Optional public URL pointing to trained LoRA weights — leave empty to run the base model.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the LoRA effect when a URL is provided.",
				key: "loraScale",
				label: "LoRA scale",
				max: 1,
				min: 0,
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
			const parsed = falFastSdxlParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/fast-sdxl",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				negative_prompt: parsed.negativePrompt,
				format: parsed.outputFormat,
				expand_prompt: false,
				enable_safety_checker: parsed.enableSafetyChecker,
				loras: parsed.loraUrl
					? [{ path: parsed.loraUrl, scale: parsed.loraScale }]
					: [],
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-fast-fooocus-sdxl": {
		baseModel: "sdxl",
		key: "fal-fast-fooocus-sdxl",
		name: "Fast Fooocus SDXL",
		description:
			"Fooocus extreme speed mode for Stable Diffusion XL text-to-image generation on fal.ai. Optionally accepts embedding weights.",
		requiresInputImage: false,
		parameterSchema: falFastFooocusSdxlParamsSchema,
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
				max: 24,
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
					"Optional public URL pointing to Fooocus embedding weights.",
				key: "embeddingUrl",
				label: "Embedding URL",
				optional: true,
				type: "text",
			},
			{
				description:
					"Optional comma-separated trigger tokens for the embedding.",
				key: "embeddingTokens",
				label: "Embedding tokens",
				optional: true,
				type: "text",
			},
			{
				description: "Run Fooocus refiner after the fast base pass.",
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
			const parsed = falFastFooocusSdxlParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/fast-fooocus-sdxl",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				negative_prompt: parsed.negativePrompt,
				format: parsed.outputFormat,
				expand_prompt: false,
				enable_refiner: parsed.enableRefiner,
				enable_safety_checker: false,
				embeddings: buildFooocusEmbeddings(parsed),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"runpod-fooocus-sdxl": {
		baseModel: "sdxl",
		key: "runpod-fooocus-sdxl",
		name: "Fooocus SDXL (RunPod)",
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
			const loras = buildRunpodFooocusLoras(parsed);
			return {
				__runpodEndpoint: "fooocus-sdxl",
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
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-flux-dev": {
		baseModel: "flux",
		key: "fal-flux-dev",
		name: "Flux Dev",
		description:
			"High-quality text-to-image generation using FLUX.1-dev with full guidance control. Optionally accepts a LoRA URL to apply custom style weights.",
		requiresInputImage: false,
		parameterSchema: falFluxDevParamsSchema,
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
				type: "number",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Number of images",
				type: "number",
			},
			{
				description:
					"Optional public URL pointing to trained LoRA weights — leave empty to run the base model.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the LoRA effect when a URL is provided.",
				key: "loraScale",
				label: "LoRA scale",
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
			const parsed = falFluxDevParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/flux-lora",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				loras: parsed.loraUrl
					? [{ path: parsed.loraUrl, scale: parsed.loraScale }]
					: [],
				enable_safety_checker: parsed.enableSafetyChecker,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-zimage-turbo": {
		baseModel: "z-image-turbo",
		key: "fal-zimage-turbo",
		name: "Z-Image Turbo",
		description:
			"Lightning-fast text-to-image generation using Z-Image Turbo (6B) on fal.ai. Optionally accepts up to two LoRA URLs to apply custom style weights.",
		requiresInputImage: false,
		parameterSchema: falZimageTurboParamsSchema,
		parameterFields: [
			{
				description: "Output image size preset.",
				key: "imageSize",
				label: "Image size",
				type: "text",
			},
			{
				description: "Number of denoising steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Number of images to generate.",
				key: "numImages",
				label: "Images",
				type: "number",
			},
			{
				description:
					"Optional public URL pointing to trained LoRA weights — leave empty to run the base model.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the primary LoRA effect when provided.",
				key: "loraWeight",
				label: "LoRA weight",
				type: "number",
			},
			{
				description: "Optional additional LoRA weights URL.",
				key: "extraLoraUrl",
				kind: "lora-url",
				label: "Extra LoRA URL",
				type: "text",
			},
			{
				description: "Optional additional LoRA strength.",
				key: "extraLoraWeight",
				label: "Extra LoRA weight",
				type: "number",
			},
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = falZimageTurboParamsSchema.parse(params);
			const loras: Array<{ path: string; weight: number }> = [];
			if (parsed.loraUrl) {
				loras.push({ path: parsed.loraUrl, weight: parsed.loraWeight });
			}
			if (parsed.extraLoraUrl) {
				loras.push({
					path: parsed.extraLoraUrl,
					weight: parsed.extraLoraWeight,
				});
			}
			return {
				__falModel: "fal-ai/z-image/turbo/lora",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				output_format: parsed.outputFormat,
				loras,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-zimage-turbo-image-to-image": {
		baseModel: "z-image-turbo",
		key: "fal-zimage-turbo-image-to-image",
		name: "Z-Image Turbo Image-to-Image",
		description:
			"Z-Image Turbo image-to-image generation on fal.ai. Optionally accepts up to two LoRA URLs to apply custom style weights.",
		requiresInputImage: true,
		parameterSchema: falZimageTurboImageToImageParamsSchema,
		parameterFields: [
			{
				description: "Output image size preset.",
				key: "imageSize",
				label: "Image size",
				type: "text",
			},
			{
				description: "Image-to-image conditioning strength.",
				key: "strength",
				label: "Strength",
				type: "number",
			},
			{
				description: "Number of denoising steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description:
					"Optional public URL pointing to trained LoRA weights — leave empty to run the base model.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the primary LoRA effect when provided.",
				key: "loraWeight",
				label: "LoRA weight",
				type: "number",
			},
			{
				description: "Optional additional LoRA weights URL.",
				key: "extraLoraUrl",
				kind: "lora-url",
				label: "Extra LoRA URL",
				type: "text",
			},
			{
				description: "Optional additional LoRA strength.",
				key: "extraLoraWeight",
				label: "Extra LoRA weight",
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falZimageTurboImageToImageParamsSchema.parse(params);
			const loras: Array<{ path: string; weight: number }> = [];
			if (parsed.loraUrl) {
				loras.push({ path: parsed.loraUrl, weight: parsed.loraWeight });
			}
			if (parsed.extraLoraUrl) {
				loras.push({
					path: parsed.extraLoraUrl,
					weight: parsed.extraLoraWeight,
				});
			}
			return {
				__falModel: "fal-ai/z-image/turbo/image-to-image/lora",
				prompt,
				image_url: inputImageUrl,
				strength: parsed.strength,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				output_format: parsed.outputFormat,
				loras,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-flux2-turbo": {
		baseModel: "flux",
		key: "fal-flux2-turbo",
		name: "Flux 2 Turbo",
		description:
			"Fast text-to-image generation using FLUX.2 [dev] in turbo mode on fal.ai.",
		requiresInputImage: false,
		parameterSchema: falFlux2TurboParamsSchema,
		parameterFields: [
			{
				description:
					"Output image size preset or custom width/height (512-2048).",
				key: "imageSize",
				label: "Image size",
				type: "text",
			},
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Number of images",
				type: "number",
			},
			{
				description: "Output image format.",
				key: "outputFormat",
				label: "Output format",
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
			const parsed = falFlux2TurboParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/flux-2/turbo",
				prompt,
				image_size: parsed.imageSize,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				enable_prompt_expansion: false,
				output_format: parsed.outputFormat,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	...falImageEditWorkflowRegistry,
	"fal-wan-2-2-text-to-video": {
		baseModel: "wan-2-2",
		key: "fal-wan-2-2-text-to-video",
		name: "Wan 2.2 A14B",
		description:
			"High-quality text-to-video generation using Wan 2.2 A14B on fal.ai. Optionally accepts paired high/low LoRA URLs (one per transformer).",
		requiresInputImage: false,
		parameterSchema: falWan22TextToVideoParamsSchema,
		parameterFields: [
			{
				description: "Number of source frames to generate.",
				key: "numFrames",
				label: "Frames",
				type: "number",
			},
			{
				description: "Source frames per second before interpolation.",
				key: "framesPerSecond",
				label: "FPS",
				type: "number",
			},
			{
				description: "Output video resolution.",
				enumValues: ["480p", "580p", "720p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Output video aspect ratio.",
				enumValues: ["16:9", "9:16", "1:1"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Number of sampling steps.",
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
				description: "Second-stage guidance scale.",
				key: "guidanceScale2",
				label: "Guidance scale 2",
				type: "number",
			},
			{
				description: "Temporal shift value for video sampling.",
				key: "shift",
				label: "Shift",
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
			const parsed = falWan22TextToVideoParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/wan/v2.2-a14b/text-to-video/lora",
				prompt,
				negative_prompt: parsed.negativePrompt,
				num_frames: parsed.numFrames,
				frames_per_second: parsed.framesPerSecond,
				resolution: parsed.resolution,
				aspect_ratio: parsed.aspectRatio,
				num_inference_steps: parsed.numInferenceSteps,
				enable_safety_checker: parsed.enableSafetyChecker,
				enable_output_safety_checker: parsed.enableOutputSafetyChecker,
				enable_prompt_expansion: false,
				acceleration: parsed.acceleration,
				guidance_scale: parsed.guidanceScale,
				guidance_scale_2: parsed.guidanceScale2,
				shift: parsed.shift,
				interpolator_model: parsed.interpolatorModel,
				num_interpolated_frames: parsed.numInterpolatedFrames,
				adjust_fps_for_interpolation: parsed.adjustFpsForInterpolation,
				video_quality: parsed.videoQuality,
				video_write_mode: parsed.videoWriteMode,
				loras: buildWanLoras(parsed),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-wan-2-2-image-to-video": {
		baseModel: "wan-2-2",
		key: "fal-wan-2-2-image-to-video",
		name: "Wan 2.2 A14B I2V",
		description:
			"Image-to-video generation using Wan 2.2 A14B on fal.ai. Optionally accepts paired high/low LoRA URLs (one per transformer).",
		requiresInputImage: true,
		parameterSchema: falWan22ImageToVideoParamsSchema,
		parameterFields: [
			{
				description:
					"Optional ending frame URL for generating a transition video.",
				key: "endImageUrl",
				label: "End image URL",
				optional: true,
				type: "text",
			},
			{
				description: "Number of source frames to generate.",
				key: "numFrames",
				label: "Frames",
				type: "number",
			},
			{
				description: "Source frames per second before interpolation.",
				key: "framesPerSecond",
				label: "FPS",
				type: "number",
			},
			{
				description: "Output video resolution.",
				enumValues: ["480p", "580p", "720p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description:
					"Output video aspect ratio. Auto follows the uploaded input image.",
				enumValues: ["auto", "16:9", "9:16", "1:1"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Number of sampling steps.",
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
				description: "Second-stage guidance scale.",
				key: "guidanceScale2",
				label: "Guidance scale 2",
				type: "number",
			},
			{
				description: "Temporal shift value for video sampling.",
				key: "shift",
				label: "Shift",
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
			const parsed = falWan22ImageToVideoParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/wan/v2.2-a14b/image-to-video/lora",
				image_url: inputImageUrl,
				prompt,
				negative_prompt: parsed.negativePrompt,
				num_frames: parsed.numFrames,
				frames_per_second: parsed.framesPerSecond,
				resolution: parsed.resolution,
				aspect_ratio: parsed.aspectRatio,
				num_inference_steps: parsed.numInferenceSteps,
				enable_safety_checker: parsed.enableSafetyChecker,
				enable_output_safety_checker: parsed.enableOutputSafetyChecker,
				enable_prompt_expansion: false,
				acceleration: parsed.acceleration,
				guidance_scale: parsed.guidanceScale,
				guidance_scale_2: parsed.guidanceScale2,
				shift: parsed.shift,
				interpolator_model: parsed.interpolatorModel,
				num_interpolated_frames: parsed.numInterpolatedFrames,
				adjust_fps_for_interpolation: parsed.adjustFpsForInterpolation,
				video_quality: parsed.videoQuality,
				video_write_mode: parsed.videoWriteMode,
				loras: buildWanLoras(parsed),
				...(parsed.endImageUrl ? { end_image_url: parsed.endImageUrl } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-wan-2-7-image-to-video": {
		baseModel: "wan-2-7",
		key: "fal-wan-2-7-image-to-video",
		name: "Wan 2.7 I2V",
		description:
			"Image-to-video with Wan 2.7 on fal.ai. First/last frame, optional driving audio; 720p or 1080p, 2–15s clips.",
		requiresInputImage: true,
		parameterSchema: falWan27ImageToVideoParamsSchema,
		parameterFields: [
			{
				description:
					"Optional last-frame image URL for first-and-last-frame video.",
				key: "endImageUrl",
				label: "End image URL",
				optional: true,
				type: "text",
			},
			{
				description:
					"Optional driving audio URL (WAV or MP3; fal recommends 2–30s clips).",
				key: "audioUrl",
				label: "Audio URL",
				optional: true,
				type: "text",
			},
			{
				description: "Output video resolution tier.",
				enumValues: ["720p", "1080p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Output clip length in seconds (2–15).",
				key: "duration",
				label: "Duration (s)",
				max: 15,
				min: 2,
				type: "number",
			},
			{
				description:
					"Content to discourage in the output (max 500 characters).",
				key: "negativePrompt",
				label: "Negative prompt",
				optional: true,
				type: "text",
			},
			{
				description: "Optional deterministic seed (0–2147483647).",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falWan27ImageToVideoParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/wan/v2.7/image-to-video",
				image_url: inputImageUrl,
				prompt,
				negative_prompt: parsed.negativePrompt,
				resolution: parsed.resolution,
				duration: parsed.duration,
				enable_prompt_expansion: false,
				enable_safety_checker: parsed.enableSafetyChecker,
				...(parsed.endImageUrl ? { end_image_url: parsed.endImageUrl } : {}),
				...(parsed.audioUrl ? { audio_url: parsed.audioUrl } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-seedance-1-5-pro-image-to-video": {
		baseModel: "seedance-1-5-pro",
		key: "fal-seedance-1-5-pro-image-to-video",
		name: "Seedance 1.5 Pro I2V",
		description:
			"ByteDance Seedance 1.5 Pro image-to-video on fal.ai. Start/end frame, optional generated audio; 480p–1080p, 4–12s.",
		requiresInputImage: true,
		parameterSchema: falSeedance15ProImageToVideoParamsSchema,
		parameterFields: [
			{
				description: "Optional last-frame image URL (first+last frame video).",
				key: "endImageUrl",
				label: "End image URL",
				optional: true,
				type: "text",
			},
			{
				description: "Output aspect ratio.",
				enumValues: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Output resolution (480p faster, 1080p higher quality).",
				enumValues: ["480p", "720p", "1080p"],
				key: "resolution",
				label: "Resolution",
				type: "text",
			},
			{
				description: "Clip length in seconds (4–12).",
				key: "duration",
				label: "Duration (s)",
				max: 12,
				min: 4,
				type: "number",
			},
			{
				description:
					"Optional seed (-1 = random per fal). Omit for API default.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falSeedance15ProImageToVideoParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/bytedance/seedance/v1.5/pro/image-to-video",
				prompt,
				image_url: inputImageUrl,
				aspect_ratio: parsed.aspectRatio,
				resolution: parsed.resolution,
				duration: parsed.duration,
				camera_fixed: parsed.cameraFixed,
				enable_safety_checker: parsed.enableSafetyChecker,
				generate_audio: parsed.generateAudio,
				...(parsed.endImageUrl ? { end_image_url: parsed.endImageUrl } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-ltx-2-3-text-to-video": {
		baseModel: "ltx-2-3",
		key: "fal-ltx-2-3-text-to-video",
		name: "LTX 2.3 22B",
		description:
			"Text-to-video generation using LTX 2.3 22B by Lightricks on fal.ai. Optionally accepts a LoRA URL. Input moderation (fal safety checker) is off by default for person / LoRA workflows; enable it in scenario params if you need it.",
		requiresInputImage: false,
		parameterSchema: falLtx23TextToVideoParamsSchema,
		parameterFields: [
			{
				description: "Number of source frames to generate.",
				key: "numFrames",
				label: "Frames",
				type: "number",
			},
			{
				description: "Output video size preset.",
				enumValues: [
					"square_hd",
					"square",
					"portrait_4_3",
					"portrait_16_9",
					"landscape_4_3",
					"landscape_16_9",
				],
				key: "videoSize",
				label: "Video size",
				type: "text",
			},
			{
				description: "Frames per second of the generated video.",
				key: "fps",
				label: "FPS",
				type: "number",
			},
			{
				description: "Number of denoising steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description:
					"Classifier-free guidance scale for the video stream (higher = more prompt adherence).",
				key: "videoCfgScale",
				label: "CFG scale",
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
					"Optional public URL pointing to trained LTX 2 LoRA weights.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				optional: true,
				type: "text",
			},
			{
				description: "Strength of the LoRA effect (ignored when no LoRA set).",
				key: "loraScale",
				label: "LoRA scale",
				type: "number",
			},
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = falLtx23TextToVideoParamsSchema.parse(params);
			const loraPath = parsed.loraUrl ?? "";
			return {
				__falModel: "fal-ai/ltx-2.3-22b/text-to-video/lora",
				prompt,
				negative_prompt: parsed.negativePrompt,
				num_frames: parsed.numFrames,
				video_size: parsed.videoSize,
				fps: parsed.fps,
				num_inference_steps: parsed.numInferenceSteps,
				video_cfg_scale: parsed.videoCfgScale,
				generate_audio: parsed.generateAudio,
				use_multiscale: parsed.useMultiscale,
				enable_prompt_expansion: false,
				enable_safety_checker: parsed.enableSafetyChecker,
				loras: [{ path: loraPath, scale: parsed.loraScale }],
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-ltx-2-3-image-to-video": {
		baseModel: "ltx-2-3",
		key: "fal-ltx-2-3-image-to-video",
		name: "LTX 2.3 22B I2V",
		description:
			"Image-to-video generation using LTX 2.3 22B by Lightricks on fal.ai. Optionally accepts a LoRA URL. Input moderation (fal safety checker) is off by default for person / LoRA workflows; enable it in scenario params if you need it.",
		requiresInputImage: true,
		parameterSchema: falLtx23ImageToVideoParamsSchema,
		parameterFields: [
			{
				description:
					"Optional ending frame URL for generating a transition video.",
				key: "endImageUrl",
				label: "End image URL",
				optional: true,
				type: "text",
			},
			{
				description: "Number of source frames to generate.",
				key: "numFrames",
				label: "Frames",
				type: "number",
			},
			{
				description:
					"Output video size preset. Auto follows the uploaded input image.",
				enumValues: [
					"auto",
					"square_hd",
					"square",
					"portrait_4_3",
					"portrait_16_9",
					"landscape_4_3",
					"landscape_16_9",
				],
				key: "videoSize",
				label: "Video size",
				type: "text",
			},
			{
				description: "Frames per second of the generated video.",
				key: "fps",
				label: "FPS",
				type: "number",
			},
			{
				description: "Number of denoising steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description:
					"Classifier-free guidance scale for the video stream (higher = more prompt adherence).",
				key: "videoCfgScale",
				label: "CFG scale",
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
					"Optional public URL pointing to trained LTX 2 LoRA weights.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
				optional: true,
				type: "text",
			},
			{
				description: "Strength of the LoRA effect (ignored when no LoRA set).",
				key: "loraScale",
				label: "LoRA scale",
				type: "number",
			},
			{
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falLtx23ImageToVideoParamsSchema.parse(params);
			const loraPath = parsed.loraUrl ?? "";
			return {
				__falModel: "fal-ai/ltx-2.3-22b/image-to-video/lora",
				image_url: inputImageUrl,
				prompt,
				negative_prompt: parsed.negativePrompt,
				num_frames: parsed.numFrames,
				video_size: parsed.videoSize,
				fps: parsed.fps,
				num_inference_steps: parsed.numInferenceSteps,
				video_cfg_scale: parsed.videoCfgScale,
				generate_audio: parsed.generateAudio,
				use_multiscale: parsed.useMultiscale,
				enable_prompt_expansion: false,
				enable_safety_checker: parsed.enableSafetyChecker,
				loras: [{ path: loraPath, scale: parsed.loraScale }],
				...(parsed.endImageUrl ? { end_image_url: parsed.endImageUrl } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
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

function enrichField(field: WorkflowField, workflowKey: string): WorkflowField {
	if (field.enumValues || field.min !== undefined || field.max !== undefined) {
		return field;
	}

	switch (field.key) {
		case "imageSize": {
			const supportsAuto =
				workflowKey === "fal-zimage-turbo-image-to-image" ||
				workflowKey === "fal-flux2-dev-edit";
			const enumValues = supportsAuto
				? (["auto", ...SUPPORTED_IMAGE_SIZES] as const)
				: SUPPORTED_IMAGE_SIZES;
			return { ...field, enumValues };
		}
		case "outputFormat":
			return { ...field, enumValues: SUPPORTED_OUTPUT_FORMATS };
		case "numInferenceSteps": {
			let max = 50;
			if (workflowKey === "fal-flux-schnell") {
				max = 12;
			} else if (workflowKey.startsWith("fal-zimage-turbo")) {
				max = 20;
			} else if (workflowKey.startsWith("fal-ltx-2-3")) {
				max = 60;
			}
			return { ...field, min: 1, max, step: 1, unit: "steps" };
		}
		case "guidanceScale":
		case "guidanceScale2":
			return { ...field, min: 1, max: 20, step: 0.1 };
		case "shift":
			return { ...field, min: 1, max: 10, step: 0.1 };
		case "numFrames": {
			const max = workflowKey.startsWith("fal-ltx-2-3") ? 257 : 161;
			return { ...field, min: 17, max, step: 1, unit: "frames" };
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
	return Object.values(workflowRegistry).map((workflow) => {
		const result = workflow.parameterSchema.safeParse({});
		return {
			baseModel: workflow.baseModel,
			defaults: (result.success ? result.data : {}) as Record<string, unknown>,
			description: workflow.description,
			key: workflow.key,
			name: workflow.name,
			parameterFields: workflow.parameterFields.map((field) =>
				enrichField(field, workflow.key)
			),
			requiresInputImage: workflow.requiresInputImage,
		};
	});
}

export function getWorkflowDefinition(workflowKey: string) {
	return workflowRegistry[workflowKey as WorkflowKey] ?? null;
}
