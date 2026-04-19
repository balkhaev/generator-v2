/**
 * Общий dataset-builder для LoRA-тренировок: генерирует синтетические вариации
 * через выбранную fal.ai edit-модель (см. dataset-editor-models.ts), миксует
 * с дубликатами оригинального референса и пакует в zip с captions.
 * Используется и в fal-, и в runpod-runner-ах, чтобы провайдер тренировки
 * можно было менять, не перетряхивая dataset prep.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { downloadImageAsset } from "@generator/storage";
import {
	DEFAULT_DATASET_EDITOR_MODEL_ID,
	getDatasetEditorModelAdapter,
} from "@/providers/dataset-editor-models";

const FAL_QUEUE_BASE = "https://queue.fal.run";
const REQUEST_TIMEOUT_MS = 120_000;
/**
 * @deprecated используйте `DEFAULT_DATASET_EDITOR_MODEL_ID` из
 * `dataset-editor-models.ts`. Оставлено как алиас для обратной совместимости.
 */
export const FLUX_REFERENCE_EDIT_MODEL = DEFAULT_DATASET_EDITOR_MODEL_ID;
export const DEFAULT_DATASET_POLL_MS = 5000;
export const DEFAULT_DATASET_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

const fileExtensionPattern = /\.[^.]+$/u;

/**
 * Анти-дрейф для лица. Передаётся в адаптеры моделей; те, что не поддерживают
 * `negative_prompt` (nano-banana, seedream, flux-pro/kontext), обычно
 * подмешивают мягкий хинт в конец основного промпта или игнорируют значение.
 */
export const IDENTITY_NEGATIVE_PROMPT =
	"different person, different face, altered identity, swapped face, plastic surgery look, doll face, cartoon, anime, distorted face, asymmetric face, melted features, blurry face, deformed eyes, extra fingers";

interface ReferenceVariant {
	caption: string;
	prompt: string;
}

interface OriginalPhotoSlot {
	caption: string;
}

const ORIGINAL_PHOTO_SLOTS = [
	{ caption: "candid reference photograph" },
	{ caption: "natural reference portrait" },
	{ caption: "casual reference photo, natural daylight" },
	{ caption: "personal reference snapshot" },
	{ caption: "honest unretouched reference photograph" },
	{ caption: "everyday reference portrait, indoor light" },
] as const satisfies readonly OriginalPhotoSlot[];

const REFERENCE_DATASET_VARIANTS: readonly ReferenceVariant[] = [
	{
		caption:
			"close-up beauty headshot, soft window light, neutral grey backdrop, eyes to camera, relaxed expression",
		prompt:
			"close-up beauty headshot, soft diffused north-window light, neutral grey backdrop, eyes to camera, relaxed neutral expression",
	},
	{
		caption:
			"medium outdoor portrait, golden hour, blurred park background, plain top, eyes to camera",
		prompt:
			"medium outdoor portrait, warm golden hour sunlight, blurred park greenery in the background, plain crew neck top, eyes to camera, relaxed neutral expression",
	},
	{
		caption:
			"half-body urban portrait, overcast soft daylight, blurred street background, plain dark sweater, eyes to camera",
		prompt:
			"half-body environmental portrait, modern urban sidewalk fully blurred in the background, overcast soft daylight, plain dark sweater, eyes to camera, neutral expression",
	},
	{
		caption:
			"editorial half-body shot, clean white studio backdrop, soft beauty dish lighting, plain top, eyes to camera",
		prompt:
			"editorial half-body portrait, clean white seamless studio backdrop, soft beauty dish lighting from front, plain neutral top, eyes to camera, neutral relaxed expression",
	},
	{
		caption:
			"seated indoor portrait, warm ambient lamp light, plain interior background, plain knit top, eyes to camera",
		prompt:
			"relaxed seated indoor portrait, warm ambient lamp light, softly blurred plain interior background, plain knit top, eyes to camera, calm gentle expression",
	},
	{
		caption:
			"interior half-body portrait, warm tungsten light, plain neutral background, plain dark top, eyes to camera",
		prompt:
			"half-body interior portrait, soft warm tungsten lighting, plain neutral background, simple dark top, eyes to camera, gentle natural expression",
	},
	{
		caption:
			"high-key headshot, fresh morning daylight, no makeup, plain white tee, slight closed-mouth smile",
		prompt:
			"high-key headshot in fresh morning daylight, plain off-white background, natural untouched skin with no visible makeup, plain white t-shirt, slight closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"half-body autumn outdoor portrait, soft overcast light, plain knit sweater, eyes to camera",
		prompt:
			"half-body outdoor autumn portrait, soft overcast diffuse light, blurred warm earthy background, plain knit sweater, eyes to camera, neutral expression",
	},
	{
		caption:
			"corporate headshot, medium grey background, soft frontal clamshell lighting, plain dark shirt, friendly closed-mouth smile",
		prompt:
			"professional corporate headshot, solid medium grey backdrop, soft frontal clamshell lighting, plain dark collared shirt, friendly closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"cafe half-body portrait, soft window daylight, blurred wooden interior, plain top, eyes to camera",
		prompt:
			"half-body cafe portrait, soft daylight from a large window, warm blurred wooden interior, plain neutral top, eyes to camera, neutral relaxed expression",
	},
	{
		caption:
			"bright kitchen half-body shot, soft morning daylight, plain top, eyes to camera",
		prompt:
			"half-body shot in a bright modern kitchen, soft morning daylight from a large window, blurred plain interior background, plain top, eyes to camera, neutral expression",
	},
	{
		caption:
			"tight frontal headshot, off-white background, soft frontal beauty lighting, neutral relaxed expression, sharp focus on face",
		prompt:
			"tight frontal headshot of the face and shoulders, plain off-white seamless background, soft frontal beauty lighting, eye-level camera, neutral relaxed expression, both eyes clearly visible to camera, sharp focus on face",
	},
	{
		caption:
			"close-up headshot, soft pastel pink seamless backdrop, soft frontal softbox, plain cream silk top, neutral expression",
		prompt:
			"close-up beauty headshot, soft pastel pink seamless backdrop, soft frontal softbox lighting, plain cream silk shell top, eye-level camera, neutral relaxed expression, both eyes to camera",
	},
	{
		caption:
			"close-up headshot, cool blue-grey backdrop, soft north-window light, plain charcoal crewneck top, neutral expression",
		prompt:
			"close-up beauty headshot, cool blue-grey seamless backdrop, soft diffused north-window light, plain charcoal crewneck top, eye-level camera, neutral relaxed expression, both eyes to camera",
	},
	{
		caption:
			"half-body portrait, warm beige seamless backdrop, neutral softbox key plus fill, plain camel cashmere sweater, gentle closed-mouth smile",
		prompt:
			"half-body portrait, warm beige seamless backdrop, neutral softbox key plus soft fill, plain camel cashmere sweater, eye-level camera, gentle closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"close-up portrait, soft sage green interior wall, soft diffused window light, plain olive linen blouse, neutral expression",
		prompt:
			"close-up portrait, softly blurred sage green interior wall, soft diffused window light, plain olive linen blouse, eye-level camera, neutral relaxed expression, eyes to camera",
	},
	{
		caption:
			"half-body outdoor portrait, neutral concrete wall, soft overcast daylight, plain navy crewneck top, neutral expression",
		prompt:
			"half-body outdoor portrait against a smoothly blurred neutral concrete wall, soft overcast daylight, plain navy crewneck top, eye-level camera, neutral relaxed expression, eyes to camera",
	},
	{
		caption:
			"close-up headshot, dusty rose backdrop, large frontal softbox, plain ivory cotton tee, soft closed-mouth smile",
		prompt:
			"close-up beauty headshot, dusty rose seamless backdrop, large frontal softbox lighting, plain ivory cotton tee, eye-level camera, soft closed-mouth smile, eyes to camera",
	},
	{
		caption:
			"shoulder-up frontal portrait, off-white seamless, soft daylight LED panel, plain heather grey tee, fresh neutral expression",
		prompt:
			"shoulder-up frontal portrait, plain off-white seamless backdrop, soft daylight-balanced LED panel from front, plain heather grey cotton tee, eye-level camera, fresh neutral expression, eyes to camera",
	},
] as const;

export const ORIGINAL_PHOTO_DUPLICATES = ORIGINAL_PHOTO_SLOTS.length;
export const REFERENCE_VARIANT_COUNT = REFERENCE_DATASET_VARIANTS.length;
export const TOTAL_DATASET_COUNT =
	REFERENCE_VARIANT_COUNT + ORIGINAL_PHOTO_DUPLICATES;

const FEMALE_PATTERNS =
	/\b(woman|girl|female|женщина|девушка|девочка|she|her)\b/i;
const MALE_PATTERNS = /\b(man|boy|male|мужчина|парень|мальчик|he|his)\b/i;

const IDENTITY_PRESERVATION_HINT =
	"exact same face and identity as the reference, identical facial features, identical eyes nose and mouth, identical face shape, photorealistic skin, accurate likeness, do not alter the face";

const IDENTITY_PROMPT_PREFIX =
	"same exact person from the reference image, identical face and identity";

export function inferGenderHint(description?: string | null): string | null {
	if (!description) {
		return null;
	}
	if (FEMALE_PATTERNS.test(description)) {
		return "woman";
	}
	if (MALE_PATTERNS.test(description)) {
		return "man";
	}
	return null;
}

export function sanitizeSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/giu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
}

/**
 * Builds the LoRA trigger word. Префиксуем `ohwx` (классический rare token из
 * DreamBooth), чтобы базовая модель не имела с ним ассоциаций — вся идентичность
 * приходится на LoRA, а не на «угаданные» trainer-ом черты под имя персоны.
 */
export function buildDefaultTriggerWord(slug: string): string {
	const sanitized = sanitizeSegment(slug).replace(/-/gu, "_");
	const stem = sanitized.length > 0 ? sanitized : "person";
	return `ohwx_${stem}`.slice(0, 60);
}

function buildVariantPrompt(input: {
	referencePrompt?: string | null;
	variant: ReferenceVariant;
}): string {
	const identitySuffix = input.referencePrompt?.trim().length
		? `${input.referencePrompt.trim()}, ${IDENTITY_PRESERVATION_HINT}`
		: IDENTITY_PRESERVATION_HINT;
	return `${IDENTITY_PROMPT_PREFIX}, ${input.variant.prompt}, ${identitySuffix}`;
}

function buildVariantCaption(input: {
	genderHint: string | null;
	triggerWord: string;
	variant: ReferenceVariant;
}): string {
	const subject = input.genderHint
		? `${input.triggerWord} ${input.genderHint}`
		: input.triggerWord;
	return `a photo of ${subject}, ${input.variant.caption}`;
}

function buildOriginalPhotoCaption(input: {
	genderHint: string | null;
	slot: OriginalPhotoSlot;
	triggerWord: string;
}): string {
	const subject = input.genderHint
		? `${input.triggerWord} ${input.genderHint}`
		: input.triggerWord;
	return `a photo of ${subject}, ${input.slot.caption}`;
}

interface FalSubmitResult {
	request_id: string;
	response_url?: string;
	status_url?: string;
}

async function falRequest<T>(
	apiKey: string,
	url: string,
	init?: RequestInit
): Promise<T & Record<string, unknown>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			signal: controller.signal,
			headers: {
				authorization: `Key ${apiKey}`,
				"content-type": "application/json",
				...(init?.headers as Record<string, string> | undefined),
			},
		});
		const body = (await response.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (!response.ok || body === null) {
			const detail = body && typeof body.detail === "string" ? body.detail : "";
			throw new Error(
				detail || `fal request failed with status ${response.status}`
			);
		}
		return body as T & Record<string, unknown>;
	} finally {
		clearTimeout(timeout);
	}
}

function falSubmit(
	apiKey: string,
	model: string,
	input: Record<string, unknown>
): Promise<FalSubmitResult> {
	return falRequest<FalSubmitResult>(apiKey, `${FAL_QUEUE_BASE}/${model}`, {
		method: "POST",
		body: JSON.stringify(input),
	});
}

async function falPollUntilDone(
	apiKey: string,
	submit: FalSubmitResult,
	model: string,
	timeoutMs: number,
	pollMs: number
): Promise<Record<string, unknown>> {
	const statusUrl =
		submit.status_url ??
		`${FAL_QUEUE_BASE}/${model}/requests/${submit.request_id}/status`;
	const responseUrl =
		submit.response_url ??
		`${FAL_QUEUE_BASE}/${model}/requests/${submit.request_id}`;

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const status = await falRequest<{ status: string; error?: string }>(
			apiKey,
			statusUrl
		);
		if (typeof status.error === "string" && status.error.length > 0) {
			throw new Error(`fal job failed: ${status.error}`);
		}
		if (status.status === "COMPLETED") {
			return falRequest<Record<string, unknown>>(apiKey, responseUrl);
		}
		await sleep(pollMs);
	}
	throw new Error(`fal job timed out after ${timeoutMs}ms`);
}

async function generateReferenceImageOnce(
	apiKey: string,
	imageUrl: string,
	prompt: string,
	editorModelId: string
): Promise<string | null> {
	const adapter = getDatasetEditorModelAdapter(editorModelId);
	const modelId = adapter.descriptor.id;
	const submit = await falSubmit(
		apiKey,
		modelId,
		adapter.buildRequestBody({
			imageUrl,
			negativePrompt: IDENTITY_NEGATIVE_PROMPT,
			prompt,
		})
	);
	const result = await falPollUntilDone(
		apiKey,
		submit,
		modelId,
		DEFAULT_DATASET_TIMEOUT_MS,
		DEFAULT_DATASET_POLL_MS
	);
	return adapter.extractImageUrl(result);
}

/**
 * Generate a single reference variation through the configured fal.ai editor
 * model with N retries. The exact request shape per model lives in
 * dataset-editor-models.ts; here we just glue retries + polling.
 */
export async function generateReferenceImage(
	apiKey: string,
	imageUrl: string,
	prompt: string,
	editorModelId: string = DEFAULT_DATASET_EDITOR_MODEL_ID
): Promise<string> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
		try {
			const url = await generateReferenceImageOnce(
				apiKey,
				imageUrl,
				prompt,
				editorModelId
			);
			if (url) {
				return url;
			}
			lastError = new Error(`${editorModelId} returned no images`);
		} catch (error) {
			lastError =
				error instanceof Error
					? error
					: new Error(`${editorModelId} request failed`);
		}
		if (attempt < DEFAULT_RETRY_ATTEMPTS) {
			await sleep(DEFAULT_RETRY_DELAY_MS);
		}
	}
	throw lastError ?? new Error(`${editorModelId} failed after retries`);
}

export interface GeneratedReference {
	caption: string;
	url: string;
}

export interface ZipFileEntry {
	data: Uint8Array;
	name: string;
}

export interface ReferenceDatasetResult {
	defaultCaption: string;
	generatedReferences: GeneratedReference[];
	zipFiles: ZipFileEntry[];
}

export interface BuildReferenceDatasetInput {
	apiKey: string;
	/**
	 * fal.ai editor model id, e.g. `fal-ai/flux-2/edit`. Если не передан —
	 * используется DEFAULT_DATASET_EDITOR_MODEL_ID. Каждый runner резолвит
	 * актуальный id из admin runtime-config непосредственно перед вызовом,
	 * чтобы смена модели применялась к новым job-ам без рестарта.
	 */
	editorModelId?: string;
	genderHint: string | null;
	onStart?: () => Promise<void>;
	onVariantGenerated?: (info: {
		generated: GeneratedReference[];
		index: number;
		total: number;
	}) => Promise<void>;
	referencePhotoUrl: string;
	referencePrompt?: string | null;
	triggerWord: string;
}

/**
 * Generate the full reference dataset:
 *   - 19 синтетических вариаций через fal-ai/flux-2/edit
 *   - 6 копий оригинала с разными captions (anchor для лица)
 * Возвращает массив zip-файлов (image bytes + .txt captions) и default caption,
 * который провайдер тренировки кладёт в свой config (z-image-trainer
 * `default_caption`, ai-toolkit dataset default).
 */
export async function buildReferenceDataset(
	input: BuildReferenceDatasetInput
): Promise<ReferenceDatasetResult> {
	await input.onStart?.();

	const generatedReferences: GeneratedReference[] = [];
	for (const variant of REFERENCE_DATASET_VARIANTS) {
		const prompt = buildVariantPrompt({
			referencePrompt: input.referencePrompt,
			variant,
		});
		const caption = buildVariantCaption({
			genderHint: input.genderHint,
			triggerWord: input.triggerWord,
			variant,
		});
		const url = await generateReferenceImage(
			input.apiKey,
			input.referencePhotoUrl,
			prompt,
			input.editorModelId
		);
		generatedReferences.push({ caption, url });
		await input.onVariantGenerated?.({
			generated: generatedReferences,
			index: generatedReferences.length,
			total: REFERENCE_VARIANT_COUNT,
		});
	}

	const refPhoto = await downloadImageAsset(input.referencePhotoUrl);
	const generatedImages = await Promise.all(
		generatedReferences.map(async (entry, index) => {
			const image = await downloadImageAsset(entry.url);
			return {
				caption: entry.caption,
				data: image.data,
				name: `${String(index + ORIGINAL_PHOTO_DUPLICATES).padStart(3, "0")}${image.extension}`,
			};
		})
	);

	const zipFiles: ZipFileEntry[] = [];
	for (const [slotIndex, slot] of ORIGINAL_PHOTO_SLOTS.entries()) {
		const baseName = String(slotIndex).padStart(3, "0");
		zipFiles.push({
			name: `${baseName}${refPhoto.extension}`,
			data: refPhoto.data,
		});
		zipFiles.push({
			name: `${baseName}.txt`,
			data: new TextEncoder().encode(
				buildOriginalPhotoCaption({
					genderHint: input.genderHint,
					slot,
					triggerWord: input.triggerWord,
				})
			),
		});
	}

	for (const img of generatedImages) {
		zipFiles.push({ name: img.name, data: img.data });
		zipFiles.push({
			name: img.name.replace(fileExtensionPattern, ".txt"),
			data: new TextEncoder().encode(img.caption),
		});
	}

	const defaultCaption = buildOriginalPhotoCaption({
		genderHint: input.genderHint,
		slot: ORIGINAL_PHOTO_SLOTS[0],
		triggerWord: input.triggerWord,
	});

	return {
		defaultCaption,
		generatedReferences,
		zipFiles,
	};
}
