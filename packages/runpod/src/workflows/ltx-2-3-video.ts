import { z } from "zod";

import type {
	PodSpec,
	PodSuccessContext,
	PodWorkflow,
} from "../workflow/definition";

const TRAILING_FILENAME_PATTERN = /[^/]*$/u;

const DEFAULT_CHECKPOINT_NAME = "ltx-2.3-22b-dev.safetensors";
const DEFAULT_CHECKPOINT_URL =
	"https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-dev.safetensors";
const DEFAULT_DISTILLED_LORA_NAME =
	"ltxv/ltx2/ltx-2.3-22b-distilled-lora-384-1.1.safetensors";
const DEFAULT_DISTILLED_LORA_URL =
	"https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-distilled-lora-384-1.1.safetensors";
const DEFAULT_TEXT_ENCODER_NAME = "gemma_3_12B_it_fp4_mixed.safetensors";
const DEFAULT_TEXT_ENCODER_URL =
	"https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors";
const DEFAULT_WORKFLOW_URL =
	"https://raw.githubusercontent.com/Lightricks/ComfyUI-LTXVideo/master/example_workflows/2.3/LTX-2.3_T2V_I2V_Single_Stage_Distilled_Full.json";
const DEFAULT_LORA_NAME = "ltxv/ltx2/custom-lora.safetensors";

const finiteNumber = z.coerce.number().finite();
const finiteInt = z.coerce.number().int().finite();

export const ltx23InputSchema = z.object({
	prompt: z.string().min(1),
	negativePrompt: z.string().default(""),
	width: finiteInt.default(896),
	height: finiteInt.default(1280),
	numFrames: finiteInt.default(241),
	fps: finiteInt.default(24),
	steps: finiteInt.default(8),
	cfgScale: finiteNumber.default(1),
	seed: finiteInt.optional(),
	inputImageUrl: z.string().url().optional(),
	loraUrl: z.string().url().optional(),
	loraName: z.string().default(DEFAULT_LORA_NAME),
	loraScale: finiteNumber.default(1),
	distilledLoraUrl: z.string().url().default(DEFAULT_DISTILLED_LORA_URL),
	distilledLoraName: z.string().default(DEFAULT_DISTILLED_LORA_NAME),
	distilledLoraScale: finiteNumber.default(0.6),
	checkpointUrl: z.string().url().default(DEFAULT_CHECKPOINT_URL),
	checkpointName: z.string().default(DEFAULT_CHECKPOINT_NAME),
	textEncoderUrl: z.string().url().default(DEFAULT_TEXT_ENCODER_URL),
	textEncoderName: z.string().default(DEFAULT_TEXT_ENCODER_NAME),
	workflowUrl: z.string().url().default(DEFAULT_WORKFLOW_URL),
});

export type Ltx23Input = z.input<typeof ltx23InputSchema>;
type Ltx23Parsed = z.output<typeof ltx23InputSchema>;

export interface Ltx23Output {
	logUrl: string;
	podConsoleUrl: string;
	podId: string;
	requestId: string;
	videoUrl: string;
}

export interface Ltx23WorkflowConfig {
	civitaiApiKey?: string;
	hfToken?: string;
	id?: string;
	pod: PodSpec;
	podRunnerUrl?: string;
}

/**
 * LTX 2.3 video workflow — поднимает disposable RunPod Pod, прокидывает
 * presigned PUT URL'ы для итогового MP4 и логов, и забирает артефакт из S3.
 *
 * Контракт env совпадает с runtime'ом в `tools/runpod-ltx23-inference/`.
 */
export function createLtx23VideoWorkflow(
	config: Ltx23WorkflowConfig
): PodWorkflow<Ltx23Input, Ltx23Output> {
	const podRunnerUrl =
		config.podRunnerUrl ??
		deriveSiblingUrl(config.pod.bootstrapUrl, "pod_runner.py");

	return {
		id: config.id ?? "ltx-2-3-video",
		mode: "pod",
		pod: { namePrefix: "ltx23", ...config.pod },
		inputSchema: ltx23InputSchema as unknown as z.ZodType<Ltx23Input>,
		artifactContentType: "video/mp4",
		buildEnv(input, ctx) {
			const parsed = input as Ltx23Parsed;
			const env: Record<string, string> = {
				CFG_SCALE: stringifyNumber(parsed.cfgScale),
				CHECKPOINT_NAME: parsed.checkpointName,
				CHECKPOINT_URL: parsed.checkpointUrl,
				DISTILLED_LORA_NAME: parsed.distilledLoraName,
				DISTILLED_LORA_SCALE: stringifyNumber(parsed.distilledLoraScale),
				DISTILLED_LORA_URL: parsed.distilledLoraUrl,
				FPS: stringifyNumber(parsed.fps),
				HEIGHT: stringifyNumber(parsed.height),
				LOG_PUBLIC_URL: ctx.logPublicUrl,
				LOG_UPLOAD_URL: ctx.logUploadUrl,
				LORA_NAME: parsed.loraName,
				LORA_SCALE: stringifyNumber(parsed.loraScale),
				LORA_URL: parsed.loraUrl ?? "",
				NEGATIVE_PROMPT: parsed.negativePrompt,
				NUM_FRAMES: stringifyNumber(parsed.numFrames),
				OUTPUT_CONTENT_TYPE: ctx.outputContentType,
				OUTPUT_PUBLIC_URL: ctx.outputPublicUrl,
				OUTPUT_UPLOAD_URL: ctx.outputUploadUrl,
				POD_RUNNER_URL: podRunnerUrl,
				PROMPT: parsed.prompt,
				RUNPOD_JOB_ID: ctx.requestId,
				STEPS: stringifyNumber(parsed.steps),
				TEXT_ENCODER_NAME: parsed.textEncoderName,
				TEXT_ENCODER_URL: parsed.textEncoderUrl,
				WIDTH: stringifyNumber(parsed.width),
				WORKFLOW_URL: parsed.workflowUrl,
			};
			if (parsed.seed !== undefined) {
				env.SEED = stringifyNumber(parsed.seed);
			}
			if (parsed.inputImageUrl) {
				env.INPUT_IMAGE_URL = parsed.inputImageUrl;
			}
			if (config.hfToken) {
				env.HF_TOKEN = config.hfToken;
			}
			if (config.civitaiApiKey) {
				env.CIVITAI_API_KEY = config.civitaiApiKey;
			}
			if (ctx.timeoutMs) {
				env.RUNPOD_POD_TIMEOUT_SECONDS = String(
					Math.ceil(ctx.timeoutMs / 1000)
				);
			}
			return env;
		},
		parseOutput(ctx: PodSuccessContext): Ltx23Output {
			return {
				logUrl: ctx.logPublicUrl,
				podConsoleUrl: ctx.runpodPodConsoleUrl,
				podId: ctx.podId,
				requestId: ctx.requestId,
				videoUrl: ctx.outputPublicUrl,
			};
		},
	};
}

function stringifyNumber(value: number): string {
	return Number.isInteger(value) ? value.toString() : value.toString();
}

function deriveSiblingUrl(baseUrl: string, siblingFilename: string): string {
	try {
		const url = new URL(baseUrl);
		const segments = url.pathname.split("/");
		segments[segments.length - 1] = siblingFilename;
		url.pathname = segments.join("/");
		return url.toString();
	} catch {
		return baseUrl.replace(TRAILING_FILENAME_PATTERN, siblingFilename);
	}
}
