import { z } from "zod";
import type { ServerlessWorkflow } from "../workflow/definition";

/**
 * Общий serverless TTS workflow для движков с единым контрактом воркера
 * (`worker-tts-voxcpm`, `worker-tts-higgs`). Текст и опциональные параметры
 * передаются handler'у как есть; output нормализуется в `{ audioUrl }`.
 *
 * Воркер возвращает `{ audio: [{ filename, type: "s3_url"|"base64", data }] }`:
 *   - `s3_url` → публичный URL (заливка в S3 на стороне воркера);
 *   - `base64` → data-URL `data:audio/<mime>;base64,...`.
 */

const TTS_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;
const TTS_TTL_MS = 30 * 60 * 1000;
const MAX_TEXT_LENGTH = 5000;

const finiteNumber = z.coerce.number().finite();
const finiteInt = z.coerce.number().int().finite();

export const ttsInputSchema = z.object({
	text: z.string().min(1).max(MAX_TEXT_LENGTH),
	/** Voice cloning: публичный URL reference WAV/mp3. */
	referenceAudioUrl: z.string().url().optional(),
	/** Транскрипт reference-аудио — улучшает точность клонирования. */
	referenceText: z.string().optional(),
	/** Язык (auto у VoxCPM; подсказка для Higgs). */
	language: z.string().optional(),
	/** Voice-design / эмоция / стиль (handler сам решает как применить). */
	style: z.string().optional(),
	emotion: z.string().optional(),
	/** VoxCPM knobs. */
	cfgValue: finiteNumber.optional(),
	inferenceTimesteps: finiteInt.optional(),
	normalize: z.boolean().optional(),
	/** Higgs knobs. */
	temperature: finiteNumber.optional(),
	topK: finiteInt.optional(),
	maxNewTokens: finiteInt.optional(),
});

export type TtsInput = z.input<typeof ttsInputSchema>;

export interface TtsOutput {
	audioUrl: string;
	audioUrls: string[];
}

export interface TtsServerlessWorkflowConfig {
	endpointId: string;
	/** Workflow id, напр. `tts-voxcpm` или `tts-higgs`. */
	id: string;
	webhookUrl?: string;
}

const ttsAudioItemSchema = z
	.object({
		data: z.string(),
		filename: z.string().optional(),
		type: z.enum(["base64", "s3_url"]).optional(),
	})
	.passthrough();

const ttsOutputSchema = z
	.object({
		audio: z.array(ttsAudioItemSchema).optional(),
		audioUrl: z.string().optional(),
		error: z.string().optional(),
	})
	.passthrough();

function guessAudioMime(filename?: string): string {
	const lower = (filename ?? "").toLowerCase();
	if (lower.endsWith(".mp3")) {
		return "audio/mpeg";
	}
	if (lower.endsWith(".ogg")) {
		return "audio/ogg";
	}
	if (lower.endsWith(".m4a")) {
		return "audio/mp4";
	}
	if (lower.endsWith(".flac")) {
		return "audio/flac";
	}
	return "audio/wav";
}

function toAudioUrl(item: {
	data: string;
	filename?: string;
	type?: string;
}): string {
	if (item.type === "s3_url" || item.data.startsWith("http")) {
		return item.data;
	}
	if (item.data.startsWith("data:")) {
		return item.data;
	}
	return `data:${guessAudioMime(item.filename)};base64,${item.data}`;
}

function parseTtsOutput(raw: unknown): TtsOutput {
	const parsed = ttsOutputSchema.parse(raw);
	if (parsed.error) {
		throw new Error(`tts worker returned error: ${parsed.error}`);
	}
	const urls: string[] = [];
	if (typeof parsed.audioUrl === "string" && parsed.audioUrl.length > 0) {
		urls.push(parsed.audioUrl);
	}
	for (const item of parsed.audio ?? []) {
		const url = toAudioUrl(item);
		if (url.length > 0) {
			urls.push(url);
		}
	}
	if (urls.length === 0) {
		throw new Error("tts worker returned no audio output");
	}
	return { audioUrl: urls[0] as string, audioUrls: urls };
}

export function createTtsServerlessWorkflow(
	config: TtsServerlessWorkflowConfig
): ServerlessWorkflow<TtsInput, TtsOutput> {
	return {
		buildPayload(input: TtsInput): Record<string, unknown> {
			const parsed = ttsInputSchema.parse(input);
			// Убираем undefined-поля — handler'ам удобнее тонкий payload.
			return Object.fromEntries(
				Object.entries(parsed).filter(([, value]) => value !== undefined)
			);
		},
		defaultPolicy: {
			executionTimeout: TTS_EXECUTION_TIMEOUT_MS,
			ttl: TTS_TTL_MS,
		},
		endpointId: config.endpointId,
		id: config.id,
		inputSchema: ttsInputSchema as unknown as z.ZodType<TtsInput>,
		mode: "serverless",
		parseOutput(raw: unknown): TtsOutput {
			return parseTtsOutput(raw);
		},
		webhookUrl: config.webhookUrl,
	};
}
