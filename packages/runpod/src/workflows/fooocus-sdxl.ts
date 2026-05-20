import { z } from "zod";

import type { ServerlessWorkflow } from "../workflow/definition";

const loraSchema = z
	.object({
		model_name: z.string().optional(),
		url: z.string().min(1),
		weight: z.number().finite(),
	})
	.passthrough();

const advancedParamsSchema = z
	.object({
		overwrite_step: z.number().int().positive().optional(),
	})
	.passthrough();

export const fooocusSdxlInputSchema = z
	.object({
		api_name: z.literal("txt2img").default("txt2img"),
		prompt: z.string().min(1),
		negative_prompt: z.string().default(""),
		base_model_name: z
			.string()
			.default("juggernautXL_version6Rundiffusion.safetensors"),
		advanced_params: advancedParamsSchema.optional(),
		aspect_ratios_selection: z.string().optional(),
		image_size: z.string().optional(),
		image_number: z.number().int().positive().default(1),
		num_inference_steps: z.number().int().positive().default(30),
		guidance_scale: z.number().finite().default(4),
		num_images: z.number().int().positive().default(1),
		output_format: z.enum(["jpeg", "png", "webp"]).default("jpeg"),
		enable_refiner: z.boolean().default(true),
		enable_safety_checker: z.boolean().default(false),
		require_base64: z.boolean().default(true),
		refiner_model_name: z.string().default("None"),
		refiner_switch: z.number().finite().default(0.5),
		seed: z.number().int().nonnegative().optional(),
		image_seed: z.number().int().nonnegative().optional(),
		loras: z.array(loraSchema).default([]),
		loras_custom_urls: z.string().optional(),
	})
	.passthrough();

export type FooocusSdxlInput = z.input<typeof fooocusSdxlInputSchema>;

export interface FooocusSdxlImage {
	base64?: string;
	dataUrl?: string;
	finishReason?: string;
	url?: string;
}

export interface FooocusSdxlOutput {
	images: FooocusSdxlImage[];
}

const fooocusItemSchema = z
	.object({
		base64: z.string().optional(),
		dataUrl: z.string().optional(),
		finish_reason: z.string().optional(),
		url: z.string().optional(),
	})
	.passthrough();

const fooocusOutputSchema = z.union([
	z.array(fooocusItemSchema),
	z
		.object({
			images: z.array(fooocusItemSchema).optional(),
			image_urls: z.array(z.string()).optional(),
		})
		.passthrough(),
]);

function normalizeOutput(raw: unknown): FooocusSdxlOutput {
	const parsed = fooocusOutputSchema.parse(raw);
	if (Array.isArray(parsed)) {
		return {
			images: parsed.map((item) => ({
				base64: item.base64,
				dataUrl: item.dataUrl,
				finishReason: item.finish_reason,
				url: item.url,
			})),
		};
	}
	if (parsed.image_urls && parsed.image_urls.length > 0) {
		return { images: parsed.image_urls.map((url) => ({ url })) };
	}
	return {
		images: (parsed.images ?? []).map((item) => ({
			base64: item.base64,
			dataUrl: item.dataUrl,
			finishReason: item.finish_reason,
			url: item.url,
		})),
	};
}

export interface FooocusSdxlWorkflowConfig {
	/**
	 * Подключить fallback warm-up payload в `workflow.warmup`. Использовать
	 * только если на endpoint'е не поднять `min workers ≥ 1` в RunPod console.
	 * Правильный путь устранения cold-start'ов — active workers, не lazy
	 * ping'и через WarmupRunner. Default = false.
	 */
	enableWarmup?: boolean;
	endpointId: string;
	id?: string;
	/** Опциональный override webhook URL'a — пробрасывается в каждый submit. */
	webhookUrl?: string;
}

const FOOOCUS_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;
const FOOOCUS_TTL_MS = 30 * 60 * 1000;

export function createFooocusSdxlWorkflow(
	config: FooocusSdxlWorkflowConfig
): ServerlessWorkflow<FooocusSdxlInput, FooocusSdxlOutput> {
	const enableWarmup = config.enableWarmup ?? false;
	return {
		id: config.id ?? "fooocus-sdxl",
		mode: "serverless",
		endpointId: config.endpointId,
		inputSchema:
			fooocusSdxlInputSchema as unknown as z.ZodType<FooocusSdxlInput>,
		defaultPolicy: {
			executionTimeout: FOOOCUS_EXECUTION_TIMEOUT_MS,
			ttl: FOOOCUS_TTL_MS,
		},
		webhookUrl: config.webhookUrl,
		warmup: enableWarmup
			? {
					buildInput() {
						return {
							api_name: "txt2img",
							prompt: "warmup",
							image_number: 1,
							num_inference_steps: 1,
							guidance_scale: 1,
							require_base64: false,
							enable_refiner: false,
							output_format: "jpeg",
						} satisfies FooocusSdxlInput;
					},
				}
			: undefined,
		buildPayload(input) {
			return input as Record<string, unknown>;
		},
		parseOutput(raw) {
			return normalizeOutput(raw);
		},
	};
}
