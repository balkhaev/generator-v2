/**
 * Единый реестр fal.ai image-edit endpoints: датасет-билдер (admin) и сценарии
 * студии (workflow registry) используют одни и те же id, описания и маппинг
 * входов в API.
 */
import { z } from "zod";

import { collectFalImageUrls } from "./fal-output";
import type { WorkflowDefinition } from "./workflow-types";

const NEGATIVE_PROMPT_FALLBACK_HINT =
	"avoid changing the face, identity, or facial features";

// --- Zod: FLUX.2 [dev] edit (fal-ai/flux-2/edit) --------------------------------

export const falFlux2DevEditParamsSchema = z.object({
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

// --- Zod: nano-banana (fal-ai/nano-banana/edit) -------------------------------

const falNanoBananaEditParamsSchema = z.object({
	aspectRatio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]).default("3:4"),
	numImages: z.number().int().min(1).max(4).default(1),
	outputFormat: z.enum(["png", "jpeg"]).default("png"),
});

// --- Zod: Seedream 4 edit ------------------------------------------------------

const falSeedreamV4EditParamsSchema = z.object({
	imageSize: z
		.enum([
			"square_hd",
			"square",
			"portrait_4_3",
			"portrait_16_9",
			"landscape_4_3",
			"landscape_16_9",
		])
		.default("portrait_4_3"),
	numImages: z.number().int().min(1).max(4).default(1),
});

// --- Zod: Qwen-Image-Edit-Plus -------------------------------------------------

const falQwenImageEditPlusParamsSchema = z.object({
	guidanceScale: z.number().min(0).max(20).default(4),
	numInferenceSteps: z.number().int().min(1).max(50).default(50),
	imageSize: z
		.enum([
			"square_hd",
			"square",
			"portrait_4_3",
			"portrait_16_9",
			"landscape_4_3",
			"landscape_16_9",
		])
		.default("portrait_4_3"),
	numImages: z.number().int().min(1).max(4).default(1),
	negativePrompt: z.string().default(""),
	outputFormat: z.enum(["jpeg", "png", "webp"]).default("jpeg"),
});

// --- Zod: FLUX Pro Kontext -------------------------------------------------------

const falFluxProKontextParamsSchema = z.object({
	aspectRatio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]).default("3:4"),
	guidanceScale: z.number().min(0).max(20).default(3.5),
	numImages: z.number().int().min(1).max(4).default(1),
	outputFormat: z.enum(["jpeg", "png", "webp"]).default("jpeg"),
	safetyTolerance: z.enum(["1", "2", "3", "4", "5", "6"]).default("5"),
});

// --- Dataset builder (admin) ---------------------------------------------------

export interface DatasetEditorModelDescriptor {
	description: string;
	id: string;
	label: string;
	supportsNegativePrompt: boolean;
}

export interface BuildEditorRequestInput {
	imageUrl: string;
	negativePrompt: string;
	prompt: string;
}

export interface DatasetEditorModelAdapter {
	buildRequestBody(input: BuildEditorRequestInput): Record<string, unknown>;
	descriptor: DatasetEditorModelDescriptor;
	extractImageUrl(result: Record<string, unknown>): string | null;
}

function extractFirstImageUrl(result: Record<string, unknown>): string | null {
	const images = result.images as Array<{ url?: string }> | undefined;
	return images?.[0]?.url ?? null;
}

function extractKontextImageUrl(
	result: Record<string, unknown>
): string | null {
	const single = result.image as { url?: string } | undefined;
	if (single?.url) {
		return single.url;
	}
	return extractFirstImageUrl(result);
}

/** Порядок = порядок в селекте админки и в списке студийных image-edit workflow. */
export const FAL_IMAGE_EDIT_DATASET_ENTRIES: readonly {
	adapter: DatasetEditorModelAdapter;
	/** Ключ workflow в студии (если отличается от соглашения fal-*). */
	workflowKey: string;
}[] = [
	{
		workflowKey: "fal-flux2-dev-edit",
		adapter: {
			descriptor: {
				description:
					"Базовая модель. Быстрая, дешёвая, но иногда дрейфит лицо на 3/4 ракурсах.",
				id: "fal-ai/flux-2/edit",
				label: "FLUX.2 Edit",
				supportsNegativePrompt: true,
			},
			buildRequestBody({ imageUrl, negativePrompt, prompt }) {
				return {
					enable_prompt_expansion: false,
					guidance_scale: 1.8,
					image_size: "portrait_4_3",
					image_urls: [imageUrl],
					negative_prompt: negativePrompt,
					num_images: 1,
					num_inference_steps: 36,
					output_format: "jpeg",
					prompt,
				};
			},
			extractImageUrl: extractFirstImageUrl,
		},
	},
	{
		workflowKey: "fal-nano-banana-edit",
		adapter: {
			descriptor: {
				description:
					"Google Gemini 2.5 Flash Image (nano-banana). Лучшая identity-consistency на портретах, но дороже и без CFG/steps/negative_prompt.",
				id: "fal-ai/nano-banana/edit",
				label: "Nano Banana (Gemini 2.5 Flash Image)",
				supportsNegativePrompt: false,
			},
			buildRequestBody({ imageUrl, negativePrompt, prompt }) {
				const reinforcedPrompt =
					`${prompt}. ${negativePrompt ? `${NEGATIVE_PROMPT_FALLBACK_HINT}.` : ""}`.trim();
				return {
					aspect_ratio: "3:4",
					image_urls: [imageUrl],
					num_images: 1,
					output_format: "png",
					prompt: reinforcedPrompt,
				};
			},
			extractImageUrl: extractFirstImageUrl,
		},
	},
	{
		workflowKey: "fal-seedream-v4-edit",
		adapter: {
			descriptor: {
				description:
					"ByteDance Seedream 4 Edit. Отличный баланс identity и качества кожи, нативно понимает edit-инструкции.",
				id: "fal-ai/bytedance/seedream/v4/edit",
				label: "Seedream 4 Edit",
				supportsNegativePrompt: false,
			},
			buildRequestBody({ imageUrl, prompt }) {
				return {
					enable_safety_checker: false,
					enhance_prompt_mode: "standard",
					image_size: "portrait_4_3",
					image_urls: [imageUrl],
					num_images: 1,
					prompt,
				};
			},
			extractImageUrl: extractFirstImageUrl,
		},
	},
	{
		workflowKey: "fal-qwen-image-edit-plus",
		adapter: {
			descriptor: {
				description:
					"Qwen-Image-Edit-Plus. Поддерживает negative_prompt и CFG, выдаёт стабильное лицо при guidance≈4.",
				id: "fal-ai/qwen-image-edit-plus",
				label: "Qwen-Image-Edit-Plus",
				supportsNegativePrompt: true,
			},
			buildRequestBody({ imageUrl, negativePrompt, prompt }) {
				return {
					acceleration: "regular",
					enable_safety_checker: false,
					guidance_scale: 4,
					image_size: "portrait_4_3",
					image_urls: [imageUrl],
					negative_prompt: negativePrompt,
					num_images: 1,
					num_inference_steps: 50,
					output_format: "jpeg",
					prompt,
				};
			},
			extractImageUrl: extractFirstImageUrl,
		},
	},
	{
		workflowKey: "fal-flux-pro-kontext",
		adapter: {
			descriptor: {
				description:
					"FLUX Pro Kontext. Высокое качество и identity, но принимает только одно входное фото и один CFG-параметр.",
				id: "fal-ai/flux-pro/kontext",
				label: "FLUX Pro Kontext",
				supportsNegativePrompt: false,
			},
			buildRequestBody({ imageUrl, prompt }) {
				return {
					aspect_ratio: "3:4",
					guidance_scale: 3.5,
					image_url: imageUrl,
					num_images: 1,
					output_format: "jpeg",
					prompt,
					safety_tolerance: "5",
				};
			},
			extractImageUrl: extractKontextImageUrl,
		},
	},
] as const;

const firstDatasetEntry = FAL_IMAGE_EDIT_DATASET_ENTRIES[0];
if (!firstDatasetEntry) {
	throw new Error("FAL_IMAGE_EDIT_DATASET_ENTRIES must not be empty");
}
const DEFAULT_DATASET_ENTRY = firstDatasetEntry;

export const DEFAULT_DATASET_EDITOR_MODEL_ID =
	DEFAULT_DATASET_ENTRY.adapter.descriptor.id;

export const DATASET_EDITOR_MODEL_DESCRIPTORS: readonly DatasetEditorModelDescriptor[] =
	FAL_IMAGE_EDIT_DATASET_ENTRIES.map((e) => e.adapter.descriptor);

const ADAPTER_BY_FAL_ID = new Map(
	FAL_IMAGE_EDIT_DATASET_ENTRIES.map((e) => [
		e.adapter.descriptor.id,
		e.adapter,
	])
);

const ADAPTER_BY_WORKFLOW_KEY = new Map(
	FAL_IMAGE_EDIT_DATASET_ENTRIES.map((e) => [e.workflowKey, e.adapter])
);

export function getDatasetEditorModelAdapter(
	modelId: string | null | undefined
): DatasetEditorModelAdapter {
	if (!modelId) {
		return DEFAULT_DATASET_ENTRY.adapter;
	}
	return ADAPTER_BY_FAL_ID.get(modelId) ?? DEFAULT_DATASET_ENTRY.adapter;
}

export function isKnownDatasetEditorModelId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		FAL_IMAGE_EDIT_DATASET_ENTRIES.some(
			(e) => e.adapter.descriptor.id === value
		)
	);
}

function extractFluxProKontextArtifacts(output: unknown): string[] {
	if (!output || typeof output !== "object") {
		return [];
	}
	const record = output as Record<string, unknown>;
	const single = record.image as { url?: string } | undefined;
	if (single?.url) {
		return [single.url];
	}
	return collectFalImageUrls(output);
}

/** Workflow definitions для `workflowRegistry` (студия). */
export const falImageEditWorkflowRegistry = {
	"fal-flux2-dev-edit": {
		baseModel: "flux",
		key: "fal-flux2-dev-edit",
		name: "Flux 2 Dev Edit",
		description:
			"Reference-guided image editing with FLUX.2 [dev]. Generates variations preserving subject identity.",
		requiresInputImage: true,
		expectedDurationMs: 30 * 1000,
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
	"fal-nano-banana-edit": {
		baseModel: "other",
		key: "fal-nano-banana-edit",
		name: "Nano Banana Edit",
		description:
			"Gemini 2.5 Flash Image (nano-banana) reference-guided edits — strong identity consistency on portraits.",
		requiresInputImage: true,
		expectedDurationMs: 28 * 1000,
		parameterSchema: falNanoBananaEditParamsSchema,
		parameterFields: [
			{
				description: "Output aspect ratio.",
				enumValues: ["1:1", "3:4", "4:3", "9:16", "16:9"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Num Images",
				type: "number",
			},
			{
				description: "Output encoding.",
				enumValues: ["png", "jpeg"],
				key: "outputFormat",
				label: "Output format",
				type: "text",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falNanoBananaEditParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/nano-banana/edit",
				prompt,
				aspect_ratio: parsed.aspectRatio,
				image_urls: inputImageUrl ? [inputImageUrl] : [],
				num_images: parsed.numImages,
				output_format: parsed.outputFormat,
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-seedream-v4-edit": {
		baseModel: "other",
		key: "fal-seedream-v4-edit",
		name: "Seedream 4 Edit",
		description:
			"ByteDance Seedream 4 image editing — strong skin quality and instruction following.",
		requiresInputImage: true,
		expectedDurationMs: 28 * 1000,
		parameterSchema: falSeedreamV4EditParamsSchema,
		parameterFields: [
			{
				description: "Output image size preset.",
				enumValues: [
					"square_hd",
					"square",
					"portrait_4_3",
					"portrait_16_9",
					"landscape_4_3",
					"landscape_16_9",
				],
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
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falSeedreamV4EditParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/bytedance/seedream/v4/edit",
				prompt,
				enable_safety_checker: false,
				enhance_prompt_mode: "standard",
				image_size: parsed.imageSize,
				image_urls: inputImageUrl ? [inputImageUrl] : [],
				num_images: parsed.numImages,
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-qwen-image-edit-plus": {
		baseModel: "qwen-image-edit",
		key: "fal-qwen-image-edit-plus",
		name: "Qwen Image Edit Plus",
		description:
			"Qwen-Image-Edit-Plus — CFG, steps, and negative prompt for controllable edits.",
		requiresInputImage: true,
		expectedDurationMs: 35 * 1000,
		parameterSchema: falQwenImageEditPlusParamsSchema,
		parameterFields: [
			{
				description: "Classifier-free guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
			},
			{
				description: "Number of inference steps.",
				key: "numInferenceSteps",
				label: "Steps",
				type: "number",
			},
			{
				description: "Output image size preset.",
				enumValues: [
					"square_hd",
					"square",
					"portrait_4_3",
					"portrait_16_9",
					"landscape_4_3",
					"landscape_16_9",
				],
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
				description: "Negative prompt (what to avoid).",
				key: "negativePrompt",
				label: "Negative prompt",
				type: "text",
			},
			{
				description: "Output encoding.",
				enumValues: ["jpeg", "png", "webp"],
				key: "outputFormat",
				label: "Output format",
				type: "text",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falQwenImageEditPlusParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/qwen-image-edit-plus",
				prompt,
				acceleration: "regular",
				enable_safety_checker: false,
				guidance_scale: parsed.guidanceScale,
				image_size: parsed.imageSize,
				image_urls: inputImageUrl ? [inputImageUrl] : [],
				negative_prompt: parsed.negativePrompt,
				num_images: parsed.numImages,
				num_inference_steps: parsed.numInferenceSteps,
				output_format: parsed.outputFormat,
			};
		},
		extractArtifactUrls: collectFalImageUrls,
	},
	"fal-flux-pro-kontext": {
		baseModel: "flux-kontext",
		key: "fal-flux-pro-kontext",
		name: "FLUX Pro Kontext",
		description:
			"FLUX Pro Kontext — single reference image, high-quality identity-preserving edits.",
		requiresInputImage: true,
		expectedDurationMs: 32 * 1000,
		parameterSchema: falFluxProKontextParamsSchema,
		parameterFields: [
			{
				description: "Output aspect ratio.",
				enumValues: ["1:1", "3:4", "4:3", "9:16", "16:9"],
				key: "aspectRatio",
				label: "Aspect ratio",
				type: "text",
			},
			{
				description: "Guidance scale.",
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
			},
			{
				description: "Number of images to generate per request.",
				key: "numImages",
				label: "Num Images",
				type: "number",
			},
			{
				description: "Output encoding.",
				enumValues: ["jpeg", "png", "webp"],
				key: "outputFormat",
				label: "Output format",
				type: "text",
			},
			{
				description: "Safety tolerance level (higher = more permissive).",
				enumValues: ["1", "2", "3", "4", "5", "6"],
				key: "safetyTolerance",
				label: "Safety tolerance",
				type: "text",
			},
		],
		buildProviderInput: ({ inputImageUrl, params, prompt }) => {
			const parsed = falFluxProKontextParamsSchema.parse(params);
			return {
				__falModel: "fal-ai/flux-pro/kontext",
				prompt,
				aspect_ratio: parsed.aspectRatio,
				guidance_scale: parsed.guidanceScale,
				image_url: inputImageUrl ?? "",
				num_images: parsed.numImages,
				output_format: parsed.outputFormat,
				safety_tolerance: parsed.safetyTolerance,
			};
		},
		extractArtifactUrls: extractFluxProKontextArtifacts,
	},
} satisfies Record<string, WorkflowDefinition>;

export type FalImageEditWorkflowKey = keyof typeof falImageEditWorkflowRegistry;

/** Соответствие fal endpoint id → workflow key студии (для проверок и миграций). */
export function workflowKeyForDatasetEditorModelId(
	falModelId: string
): string | null {
	const entry = FAL_IMAGE_EDIT_DATASET_ENTRIES.find(
		(e) => e.adapter.descriptor.id === falModelId
	);
	return entry?.workflowKey ?? null;
}

export function getDatasetAdapterForWorkflowKey(
	workflowKey: string
): DatasetEditorModelAdapter | null {
	return ADAPTER_BY_WORKFLOW_KEY.get(workflowKey) ?? null;
}
