import type {
	WorkflowField,
	WorkflowSummary,
} from "@generator/contracts/generator";
import { z } from "zod";

const falFlux2DevEditParamsSchema = z.object({
	guidanceScale: z.number().min(1).max(20).default(2.5),
	numInferenceSteps: z.number().int().min(1).max(50).default(28),
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
		.default("square_hd"),
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
});

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
});

const falZimageTurboLoraParamsSchema = z.object({
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
	loraUrl: z.string().url(),
	loraWeight: z.number().min(0).max(2).default(0.8),
	extraLoraUrl: z.string().url().optional(),
	extraLoraWeight: z.number().min(0).max(2).default(0.05),
});

const falFluxLoraParamsSchema = z.object({
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
	loraUrl: z.string().url(),
	loraScale: z.number().min(0).max(2).default(1),
	enableSafetyChecker: z.boolean().default(true),
});

const cerebriumZimageTurboParamsSchema = z.object({
	width: z.number().int().min(512).max(2048).default(1024),
	height: z.number().int().min(512).max(2048).default(1024),
	numInferenceSteps: z.number().int().min(1).max(20).default(9),
	guidanceScale: z.number().min(0).max(20).default(0.0),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	outputFormat: z.enum(["png", "jpeg", "webp"]).default("jpeg"),
});

const cerebriumZimageTurboLoraParamsSchema = z.object({
	width: z.number().int().min(512).max(2048).default(1024),
	height: z.number().int().min(512).max(2048).default(1024),
	numInferenceSteps: z.number().int().min(1).max(50).default(28),
	guidanceScale: z.number().min(0).max(20).default(4.5),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	loraUrl: z.string().url(),
	loraScale: z.number().min(0).max(2).default(0.8),
	triggerWord: z.string().trim().min(1).optional(),
	outputFormat: z.enum(["png", "jpeg", "webp"]).default("jpeg"),
});

const cerebriumFlux2DevParamsSchema = z.object({
	width: z.number().int().min(512).max(2048).default(1024),
	height: z.number().int().min(512).max(2048).default(1024),
	numInferenceSteps: z.number().int().min(1).max(50).default(28),
	guidanceScale: z.number().min(1).max(20).default(3.5),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	outputFormat: z.enum(["png", "jpeg", "webp"]).default("jpeg"),
});

const ZIB_DPO_AGILE_MODEL_ID =
	"GuangyuanSD/Z-Image-Distilled:RedZFUN-v6-ZIB-Distilled-AGILE-8steps-BF16-ComfyUI.safetensors";

const cerebriumZibDpoParamsSchema = z.object({
	width: z.number().int().min(512).max(2048).default(1024),
	height: z.number().int().min(512).max(2048).default(1024),
	numInferenceSteps: z.number().int().min(1).max(20).default(8),
	guidanceScale: z.number().min(0).max(20).default(1.0),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	outputFormat: z.enum(["png", "jpeg", "webp"]).default("jpeg"),
});

const cerebriumZibDpoLoraParamsSchema = z.object({
	width: z.number().int().min(512).max(2048).default(1024),
	height: z.number().int().min(512).max(2048).default(1024),
	numInferenceSteps: z.number().int().min(1).max(20).default(8),
	guidanceScale: z.number().min(0).max(20).default(1.0),
	numImages: z.number().int().min(1).max(4).default(1),
	seed: z.number().int().nonnegative().optional(),
	loraUrl: z.string().url(),
	loraScale: z.number().min(0).max(2).default(0.8),
	triggerWord: z.string().trim().min(1).optional(),
	outputFormat: z.enum(["png", "jpeg", "webp"]).default("jpeg"),
});

const artifactDataUrlPattern = /^data:(image|video)\/[a-z0-9.+-]+;base64,/i;

export interface WorkflowDefinition<
	TParams extends z.ZodTypeAny = z.ZodTypeAny,
> {
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
		key: "fal-flux-dev",
		name: "Flux Dev",
		description:
			"High-quality text-to-image generation using FLUX.1-dev with full guidance control.",
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
				description: "Optional deterministic seed for repeatable outputs.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = falFluxDevParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/flux/dev",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-zimage-turbo": {
		key: "fal-zimage-turbo",
		name: "Z-Image Turbo",
		description:
			"Lightning-fast text-to-image generation using Z-Image Turbo (6B) on fal.ai.",
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
				description: "Optional deterministic seed.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = falZimageTurboParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/z-image/turbo",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				output_format: parsed.outputFormat,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-zimage-turbo-lora": {
		key: "fal-zimage-turbo-lora",
		name: "Z-Image Turbo + LoRA",
		description:
			"Z-Image Turbo text-to-image with custom LoRA weights on fal.ai.",
		requiresInputImage: false,
		parameterSchema: falZimageTurboLoraParamsSchema,
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
				description: "LoRA weights URL.",
				key: "loraUrl",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "LoRA strength.",
				key: "loraWeight",
				label: "LoRA weight",
				type: "number",
			},
			{
				description: "Optional additional LoRA weights URL.",
				key: "extraLoraUrl",
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
		buildProviderInput: ({ params, prompt }) => {
			const parsed = falZimageTurboLoraParamsSchema.parse(params);
			const loras = [
				{
					path: parsed.loraUrl,
					weight: parsed.loraWeight,
				},
				...(parsed.extraLoraUrl
					? [
							{
								path: parsed.extraLoraUrl,
								weight: parsed.extraLoraWeight,
							},
						]
					: []),
			];
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
	"fal-flux2-dev-edit": {
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
			return {
				__falModel: "fal-ai/flux-2/edit",
				prompt,
				image_urls: inputImageUrl ? [inputImageUrl] : [],
				guidance_scale: parsed.guidanceScale,
				num_inference_steps: parsed.numInferenceSteps,
				image_size: parsed.imageSize,
				num_images: parsed.numImages,
				enable_safety_checker: parsed.enableSafetyChecker,
				output_format: "webp",
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-flux-lora": {
		key: "fal-flux-lora",
		name: "Flux Dev LoRA (Fal)",
		description:
			"Text-to-image generation using FLUX.1-dev with custom LoRA weights.",
		requiresInputImage: false,
		parameterSchema: falFluxLoraParamsSchema,
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
				description: "Public URL pointing to the trained LoRA weights.",
				key: "loraUrl",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the LoRA effect.",
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
			const parsed = falFluxLoraParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/flux-lora",
				prompt,
				image_size: parsed.imageSize,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				loras: [{ path: parsed.loraUrl, scale: parsed.loraScale }],
				enable_safety_checker: parsed.enableSafetyChecker,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"cerebrium-zimage-turbo": {
		key: "cerebrium-zimage-turbo",
		name: "Z-Image Turbo (Cerebrium)",
		description:
			"Fast text-to-image via Z-Image Turbo (Tongyi-MAI) on Cerebrium serverless GPU. 9-step inference.",
		requiresInputImage: false,
		parameterSchema: cerebriumZimageTurboParamsSchema,
		parameterFields: [
			{
				description: "Output image width in pixels.",
				key: "width",
				label: "Width",
				type: "number",
			},
			{
				description: "Output image height in pixels.",
				key: "height",
				label: "Height",
				type: "number",
			},
			{
				description: "Number of denoising steps (recommended 9 for Turbo).",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Guidance scale (0.0 for Turbo distilled model).",
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
				description: "Optional deterministic seed for repeatable outputs.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = cerebriumZimageTurboParamsSchema.parse(params);
			return {
				__cerebriumApp: "flux-inference",
				__cerebriumFunction: "generate",
				model_id: "Tongyi-MAI/Z-Image-Turbo",
				prompt,
				width: parsed.width,
				height: parsed.height,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				output_format: parsed.outputFormat,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"cerebrium-zimage-turbo-lora": {
		key: "cerebrium-zimage-turbo-lora",
		name: "Z-Image Turbo + LoRA (Cerebrium)",
		description:
			"Z-Image Turbo text-to-image with custom LoRA weights on Cerebrium.",
		requiresInputImage: false,
		parameterSchema: cerebriumZimageTurboLoraParamsSchema,
		parameterFields: [
			{
				description: "Output image width in pixels.",
				key: "width",
				label: "Width",
				type: "number",
			},
			{
				description: "Output image height in pixels.",
				key: "height",
				label: "Height",
				type: "number",
			},
			{
				description: "Number of denoising steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
			},
			{
				description:
					"Public URL pointing to the trained LoRA weights (.safetensors).",
				key: "loraUrl",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the LoRA effect (0.5-1.2 recommended).",
				key: "loraScale",
				label: "LoRA scale",
				type: "number",
			},
			{
				description: "Trigger word used during LoRA training.",
				key: "triggerWord",
				label: "Trigger word",
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
			const parsed = cerebriumZimageTurboLoraParamsSchema.parse(params);
			return {
				__cerebriumApp: "flux-inference",
				__cerebriumFunction: "generate",
				model_id: "Tongyi-MAI/Z-Image-Turbo",
				prompt,
				width: parsed.width,
				height: parsed.height,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				lora_url: parsed.loraUrl,
				lora_scale: parsed.loraScale,
				output_format: parsed.outputFormat,
				...(parsed.triggerWord ? { trigger_word: parsed.triggerWord } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"cerebrium-flux2-dev": {
		key: "cerebrium-flux2-dev",
		name: "FLUX.2 Dev (Cerebrium)",
		description:
			"High-quality text-to-image via FLUX.2-dev (Black Forest Labs) on Cerebrium serverless GPU.",
		requiresInputImage: false,
		parameterSchema: cerebriumFlux2DevParamsSchema,
		parameterFields: [
			{
				description: "Output image width in pixels.",
				key: "width",
				label: "Width",
				type: "number",
			},
			{
				description: "Output image height in pixels.",
				key: "height",
				label: "Height",
				type: "number",
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
				description: "Optional deterministic seed for repeatable outputs.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = cerebriumFlux2DevParamsSchema.parse(params);
			return {
				__cerebriumApp: "flux-inference",
				__cerebriumFunction: "generate",
				model_id: "black-forest-labs/FLUX.2-dev",
				prompt,
				width: parsed.width,
				height: parsed.height,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				output_format: parsed.outputFormat,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"cerebrium-zib-dpo": {
		key: "cerebrium-zib-dpo",
		name: "ZIB-DPO AGILE (Cerebrium)",
		description:
			"Text-to-image via ZIB-DPO AGILE distilled checkpoint on Cerebrium. 8-step inference, cfg 1.0.",
		requiresInputImage: false,
		parameterSchema: cerebriumZibDpoParamsSchema,
		parameterFields: [
			{
				description: "Output image width in pixels.",
				key: "width",
				label: "Width",
				type: "number",
			},
			{
				description: "Output image height in pixels.",
				key: "height",
				label: "Height",
				type: "number",
			},
			{
				description: "Number of denoising steps (8 recommended for AGILE).",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Guidance scale (1.0 recommended for distilled models).",
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
				description: "Optional deterministic seed for repeatable outputs.",
				key: "seed",
				label: "Seed",
				type: "number",
			},
		],
		buildProviderInput: ({ params, prompt }) => {
			const parsed = cerebriumZibDpoParamsSchema.parse(params);
			return {
				__cerebriumApp: "flux-inference",
				__cerebriumFunction: "generate",
				model_id: ZIB_DPO_AGILE_MODEL_ID,
				prompt,
				width: parsed.width,
				height: parsed.height,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				output_format: parsed.outputFormat,
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"cerebrium-zib-dpo-lora": {
		key: "cerebrium-zib-dpo-lora",
		name: "ZIB-DPO AGILE + LoRA (Cerebrium)",
		description:
			"ZIB-DPO AGILE distilled checkpoint with custom LoRA weights on Cerebrium.",
		requiresInputImage: false,
		parameterSchema: cerebriumZibDpoLoraParamsSchema,
		parameterFields: [
			{
				description: "Output image width in pixels.",
				key: "width",
				label: "Width",
				type: "number",
			},
			{
				description: "Output image height in pixels.",
				key: "height",
				label: "Height",
				type: "number",
			},
			{
				description: "Number of denoising steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
			},
			{
				description:
					"Public URL pointing to the trained LoRA weights (.safetensors).",
				key: "loraUrl",
				label: "LoRA URL",
				type: "text",
			},
			{
				description: "Strength of the LoRA effect (0.6-1.0 recommended).",
				key: "loraScale",
				label: "LoRA scale",
				type: "number",
			},
			{
				description: "Trigger word used during LoRA training.",
				key: "triggerWord",
				label: "Trigger word",
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
			const parsed = cerebriumZibDpoLoraParamsSchema.parse(params);
			return {
				__cerebriumApp: "flux-inference",
				__cerebriumFunction: "generate",
				model_id: ZIB_DPO_AGILE_MODEL_ID,
				prompt,
				width: parsed.width,
				height: parsed.height,
				num_inference_steps: parsed.numInferenceSteps,
				guidance_scale: parsed.guidanceScale,
				num_images: parsed.numImages,
				lora_url: parsed.loraUrl,
				lora_scale: parsed.loraScale,
				output_format: parsed.outputFormat,
				...(parsed.triggerWord ? { trigger_word: parsed.triggerWord } : {}),
				...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
} satisfies Record<string, WorkflowDefinition>;

export type WorkflowKey = keyof typeof workflowRegistry;

export function listWorkflows(): WorkflowSummary[] {
	return Object.values(workflowRegistry).map((workflow) => {
		const result = workflow.parameterSchema.safeParse({});
		return {
			defaults: (result.success ? result.data : {}) as Record<string, unknown>,
			description: workflow.description,
			key: workflow.key,
			name: workflow.name,
			parameterFields: workflow.parameterFields,
		};
	});
}

export function getWorkflowDefinition(workflowKey: string) {
	return workflowRegistry[workflowKey as WorkflowKey] ?? null;
}
