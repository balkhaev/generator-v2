import type {
	WorkflowBaseModel,
	WorkflowField,
	WorkflowSummary,
} from "@generator/contracts/generator";
import { z } from "zod";

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

const falFlux2DevEditParamsSchema = z.object({
	guidanceScale: z.number().min(1).max(20).default(2.5),
	numInferenceSteps: z.number().int().min(1).max(50).default(28),
	imageSize: z
		.union([
			z.enum([
				"auto",
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
		.default("auto"),
	numImages: z.number().int().min(1).max(4).default(1),
	enableSafetyChecker: z.boolean().default(false),
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
	enableSafetyChecker: z.boolean().default(true),
});

const optionalUrlParamSchema = z.preprocess(
	(value) =>
		typeof value === "string" && value.trim() === "" ? undefined : value,
	z.string().url().optional()
);

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
	enableSafetyChecker: z.boolean().default(true),
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
const falWan22TextToVideoParamsSchema = z.object({
	negativePrompt: z.string().default(""),
	numFrames: z.number().int().min(17).max(161).default(81),
	framesPerSecond: z.number().int().min(4).max(60).default(16),
	seed: z.number().int().nonnegative().optional(),
	resolution: z.enum(["480p", "580p", "720p"]).default("720p"),
	aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
	numInferenceSteps: z.number().int().min(1).max(50).default(27),
	enableSafetyChecker: z.boolean().default(true),
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
	loraUrl: optionalUrlParamSchema,
	loraScale: z.number().min(0).max(2).default(1),
});

const falWan22ImageToVideoParamsSchema = falWan22TextToVideoParamsSchema.extend(
	{
		aspectRatio: z.enum(["auto", "16:9", "9:16", "1:1"]).default("auto"),
		guidanceScale2: z.number().min(0).max(20).default(3.5),
		endImageUrl: optionalUrlParamSchema,
	}
);

// LTX-2.3 targets the LTX-2.3-22B base text/image-to-video endpoints. fal does
// NOT expose a `/lora` submodel for LTX-2.3-22B (only `camera_lora` enum is
// supported in-schema). Sending requests to a non-existent `/lora` submodel or
// passing a `loras` array makes fal route to the parent group and then 422 on
// status/result polling. We keep `loraUrl`/`loraScale` in the param schema for
// backwards compatibility with existing scenarios but never forward them to
// the provider.
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
	generateAudio: z.boolean().default(true),
	useMultiscale: z.boolean().default(true),
	enablePromptExpansion: z.boolean().default(true),
	enableSafetyChecker: z.boolean().default(true),
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

const artifactDataUrlPattern = /^data:(image|video)\/[a-z0-9.+-]+;base64,/i;

export interface WorkflowDefinition<
	TParams extends z.ZodTypeAny = z.ZodTypeAny,
> {
	baseModel?: WorkflowBaseModel;
	buildProviderInput: (args: {
		inputImageUrl?: string;
		prompt: string;
		params: z.infer<TParams>;
	}) => Record<string, unknown>;
	description: string;
	extractArtifactUrls: (output: unknown) => string[];
	key: string;
	name: string;
	parameterFields: readonly WorkflowField[];
	parameterSchema: TParams;
	requiresInputImage: boolean;
}

function collectFalImageUrls(output: unknown): string[] {
	if (!output || typeof output !== "object") {
		return [];
	}
	const record = output as Record<string, unknown>;
	const images = record.images;
	if (!Array.isArray(images)) {
		return collectArtifactUrls(output);
	}
	const urls: string[] = [];
	for (const image of images) {
		if (image && typeof image === "object" && "url" in image) {
			const url = (image as Record<string, unknown>).url;
			if (typeof url === "string" && url.length > 0) {
				urls.push(url);
			}
		}
	}
	return urls.length > 0 ? urls : collectArtifactUrls(output);
}

function collectArtifactUrls(output: unknown): string[] {
	const looksLikeArtifactUrl = (value: string) => {
		return (
			artifactDataUrlPattern.test(value) ||
			value.startsWith("http://") ||
			value.startsWith("https://")
		);
	};

	const collect = (value: unknown): string[] => {
		if (!value) {
			return [];
		}
		if (typeof value === "string") {
			return looksLikeArtifactUrl(value) ? [value] : [];
		}
		if (Array.isArray(value)) {
			return value.flatMap(collect);
		}
		if (typeof value === "object") {
			const record = value as Record<string, unknown>;
			const directKeys = ["video", "videoUrl", "image", "imageUrl", "url"];
			const urls = directKeys.flatMap((key) => collect(record[key]));
			return urls.length > 0 ? urls : Object.values(record).flatMap(collect);
		}
		return [];
	};

	return [...new Set(collect(output))];
}

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
				enable_prompt_expansion: parsed.enablePromptExpansion,
				output_format: parsed.outputFormat,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-flux2-dev-edit": {
		baseModel: "flux",
		key: "fal-flux2-dev-edit",
		name: "Flux 2 Dev Edit",
		description:
			"Reference-guided image editing with FLUX.2 [dev]. Generates variations preserving subject identity.",
		requiresInputImage: true,
		parameterSchema: falFlux2DevEditParamsSchema,
		parameterFields: [
			{
				description: "Guidance scale for prompt adherence.",
				key: "guidanceScale",
				label: "Guidance Scale",
				type: "number",
			},
			{
				description: "Number of inference steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Output image size preset or custom dimensions.",
				key: "imageSize",
				label: "Image Size",
				type: "text",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Num Images",
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
			const parsed = falFlux2DevEditParamsSchema.parse(params);
			const inheritsSourceSize = parsed.imageSize === "auto";
			return {
				__falModel: "fal-ai/flux-2/edit",
				prompt,
				image_urls: inputImageUrl ? [inputImageUrl] : [],
				guidance_scale: parsed.guidanceScale,
				num_inference_steps: parsed.numInferenceSteps,
				...(inheritsSourceSize ? {} : { image_size: parsed.imageSize }),
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				output_format: "webp",
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-wan-2-2-text-to-video": {
		baseModel: "wan-2-2",
		key: "fal-wan-2-2-text-to-video",
		name: "Wan 2.2 A14B",
		description:
			"High-quality text-to-video generation using Wan 2.2 A14B on fal.ai. Optionally accepts a LoRA URL.",
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
			{
				description:
					"Optional public URL pointing to trained Wan 2.2 LoRA weights.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
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
			const parsed = falWan22TextToVideoParamsSchema.parse(params);
			const loras = parsed.loraUrl
				? [{ path: parsed.loraUrl, scale: parsed.loraScale }]
				: [];
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
				enable_prompt_expansion: parsed.enablePromptExpansion,
				acceleration: parsed.acceleration,
				guidance_scale: parsed.guidanceScale,
				guidance_scale_2: parsed.guidanceScale2,
				shift: parsed.shift,
				interpolator_model: parsed.interpolatorModel,
				num_interpolated_frames: parsed.numInterpolatedFrames,
				adjust_fps_for_interpolation: parsed.adjustFpsForInterpolation,
				video_quality: parsed.videoQuality,
				video_write_mode: parsed.videoWriteMode,
				loras,
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
			"Image-to-video generation using Wan 2.2 A14B on fal.ai. Optionally accepts a LoRA URL.",
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
			{
				description:
					"Optional public URL pointing to trained Wan 2.2 LoRA weights.",
				key: "loraUrl",
				kind: "lora-url",
				label: "LoRA URL",
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
			const parsed = falWan22ImageToVideoParamsSchema.parse(params);
			const loras = parsed.loraUrl
				? [{ path: parsed.loraUrl, scale: parsed.loraScale }]
				: [];
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
				enable_prompt_expansion: parsed.enablePromptExpansion,
				acceleration: parsed.acceleration,
				guidance_scale: parsed.guidanceScale,
				guidance_scale_2: parsed.guidanceScale2,
				shift: parsed.shift,
				interpolator_model: parsed.interpolatorModel,
				num_interpolated_frames: parsed.numInterpolatedFrames,
				adjust_fps_for_interpolation: parsed.adjustFpsForInterpolation,
				video_quality: parsed.videoQuality,
				video_write_mode: parsed.videoWriteMode,
				loras,
				...(parsed.endImageUrl ? { end_image_url: parsed.endImageUrl } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-ltx-2-3-text-to-video": {
		baseModel: "ltx-2-3",
		key: "fal-ltx-2-3-text-to-video",
		name: "LTX 2.3",
		description:
			"Text-to-video generation using LTX 2.3 22B by Lightricks on fal.ai.",
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
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = falLtx23TextToVideoParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/ltx-2.3-22b/text-to-video",
				prompt,
				negative_prompt: parsed.negativePrompt,
				num_frames: parsed.numFrames,
				video_size: parsed.videoSize,
				fps: parsed.fps,
				num_inference_steps: parsed.numInferenceSteps,
				generate_audio: parsed.generateAudio,
				use_multiscale: parsed.useMultiscale,
				enable_prompt_expansion: parsed.enablePromptExpansion,
				enable_safety_checker: parsed.enableSafetyChecker,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
	"fal-ltx-2-3-image-to-video": {
		baseModel: "ltx-2-3",
		key: "fal-ltx-2-3-image-to-video",
		name: "LTX 2.3 I2V",
		description:
			"Image-to-video generation using LTX 2.3 22B by Lightricks on fal.ai.",
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
				type: "number",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falLtx23ImageToVideoParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/ltx-2.3-22b/image-to-video",
				image_url: inputImageUrl,
				prompt,
				negative_prompt: parsed.negativePrompt,
				num_frames: parsed.numFrames,
				video_size: parsed.videoSize,
				fps: parsed.fps,
				num_inference_steps: parsed.numInferenceSteps,
				generate_audio: parsed.generateAudio,
				use_multiscale: parsed.useMultiscale,
				enable_prompt_expansion: parsed.enablePromptExpansion,
				enable_safety_checker: parsed.enableSafetyChecker,
				...(parsed.endImageUrl ? { end_image_url: parsed.endImageUrl } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectArtifactUrls,
	},
} satisfies Record<string, WorkflowDefinition>;

export type WorkflowKey = keyof typeof workflowRegistry;

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
			return { ...field, min: 0, max: 2, step: 0.05 };
		case "extraLoraWeight":
			return { ...field, min: 0, max: 2, step: 0.05, optional: true };
		case "extraLoraUrl":
			return { ...field, optional: true };
		case "loraUrl": {
			// Every workflow that exposes a `loraUrl` field now runs on the LoRA
			// variant of its provider endpoint, with an empty `loras` array sent
			// when no URL is provided. We mark the field optional so the UI hides
			// the required indicator and surfaces it as a "leave empty to skip"
			// affordance.
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
