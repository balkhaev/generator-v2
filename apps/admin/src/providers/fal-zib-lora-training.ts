import { setTimeout as sleep } from "node:timers/promises";
import { env } from "@generator/env/server";
import type { EventPublisher } from "@generator/events";
import {
	buildZipFromBuffers,
	downloadImageAsset,
	persistLoraWeightsToS3,
	type S3StorageConfig,
	uploadZipToS3,
} from "@generator/storage";
import { z } from "zod";

const FAL_QUEUE_BASE = "https://queue.fal.run";
const REQUEST_TIMEOUT_MS = 120_000;
/**
 * 1500 шагов на 20-кадровом датасете давало заметный оверфит на синтетику
 * (z-image-trainer запоминал артефакты flux-2/edit). 1200 даёт лучший баланс
 * между усвоением идентичности и сохранением гибкости при инференсе.
 */
const DEFAULT_TRAINING_STEPS = 1200;
const DEFAULT_TRAINING_POLL_MS = 30_000;
const DEFAULT_TRAINING_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_DATASET_POLL_MS = 5000;
const DEFAULT_DATASET_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const FLUX_REFERENCE_EDIT_MODEL = "fal-ai/flux-2/edit";
const fileExtensionPattern = /\.[^.]+$/u;

/**
 * Параметры flux-2/edit, подобранные под максимальное сохранение идентичности.
 *
 * `guidance_scale` понижен с 2.5 до 1.8: при более высоком CFG модель
 * агрессивнее переписывает лицо под текстовый промпт, добавляя «обобщённую»
 * красоту вместо конкретных черт референса. 1.8 — нижний край, при котором
 * композиция сцены ещё надёжно собирается.
 *
 * `num_inference_steps` поднят с 28 до 36 — лишние шаги уходят в полировку
 * деталей лица, а не в перерисовку, и снижают вероятность артефактов глаз/носа,
 * которые потом «вмораживаются» LoRA.
 */
const IDENTITY_GUIDANCE_SCALE = 1.8;
const IDENTITY_INFERENCE_STEPS = 36;

/**
 * Анти-дрейф для лица. flux-2/edit поддерживает negative_prompt у части
 * вариантов; даже если параметр игнорируется конкретной версией модели,
 * это безопасный no-op.
 */
const IDENTITY_NEGATIVE_PROMPT =
	"different person, different face, altered identity, swapped face, plastic surgery look, doll face, cartoon, anime, distorted face, asymmetric face, melted features, blurry face, deformed eyes, extra fingers";

interface ReferenceVariant {
	caption: string;
	prompt: string;
}

interface OriginalPhotoSlot {
	caption: string;
}

/**
 * Captions used when the original reference photo is duplicated in the dataset.
 * The image bytes are identical across slots; only the caption differs so the
 * trainer sees the trigger word in slightly different surface forms while the
 * face stays absolutely consistent. Order matters — slot 0 is also used as the
 * z-image-trainer `default_caption`.
 */
const ORIGINAL_PHOTO_SLOTS = [
	{ caption: "candid reference photograph" },
	{ caption: "natural reference portrait" },
	{ caption: "casual reference photo, natural daylight" },
	{ caption: "personal reference snapshot" },
	{ caption: "honest unretouched reference photograph" },
	{ caption: "everyday reference portrait, indoor light" },
] as const satisfies readonly OriginalPhotoSlot[];

/**
 * Синтетические вариации для тренировки идентичности через flux-2/edit.
 *
 * Жёсткие правила, по которым отобраны варианты:
 *
 *   1. Только фронт и почти-фронт (≤ 15° поворот головы). flux-2/edit
 *      сильнее всего дрейфит лицо именно на 3/4 и профилях — такие кадры
 *      раньше встречались в датасете и портили консистентность LoRA.
 *   2. Никакой выраженной мимики (нет laugh, открытого рта, прищура).
 *      Сильные эмоции деформируют рот/глаза — модель усредняет.
 *   3. Кадрирование — только close-up или head-and-shoulders / half-body.
 *      Full-body убраны: на маленькой площади лица flux-2/edit «домысливает»
 *      черты с минимальной верностью референсу.
 *   4. Описания одежды/деталей — максимально нейтральные (plain top,
 *      plain sweater). Чем меньше слов в промпте описывает не-сцену, тем
 *      меньше места для перерисовки лица под несвязанный контекст.
 *   5. Captions не описывают идентичность (eye color, hair color и т.п.) —
 *      триггер-слово остаётся единственным «слотом», в который трейнер
 *      может вписать лицо.
 *
 * Identity-якорь («same exact person, identical face…») добавляется
 * автоматически в `buildVariantPrompt`; здесь хранится только описание сцены.
 */
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
] as const;

/**
 * Сколько раз оригинальное референс-фото кладётся в датасет (с разными
 * подписями). Оригинал — единственный пиксель-точный носитель идентичности,
 * каждый синтетический вариант добавляет дрейф. Эти копии перевешивают
 * синтетические кадры так, чтобы тренер «якорил» лицо именно на оригинале,
 * а не на усреднении flux-2/edit-вариаций.
 *
 * Деривится из длины `ORIGINAL_PHOTO_SLOTS`, чтобы расхождение между
 * счётчиком и фактическим количеством слотов было невозможно.
 */
const ORIGINAL_PHOTO_DUPLICATES = ORIGINAL_PHOTO_SLOTS.length;

const REFERENCE_COUNT = REFERENCE_DATASET_VARIANTS.length;
const ORIGINAL_DATASET_COUNT = ORIGINAL_PHOTO_DUPLICATES;
const TOTAL_DATASET_COUNT = REFERENCE_COUNT + ORIGINAL_DATASET_COUNT;

export const startFalZibLoraTrainingSchema = z.object({
	debugCorrelationId: z.string().trim().min(1).optional(),
	description: z.string().trim().optional(),
	outputName: z.string().trim().min(1).optional(),
	personId: z.string().trim().min(1),
	personName: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	referencePhotoUrl: z.url(),
	referencePrompt: z.string().trim().min(1).optional(),
	trainingRunId: z.string().trim().min(1),
	triggerWord: z.string().trim().min(1).optional(),
});

type StartInput = z.infer<typeof startFalZibLoraTrainingSchema>;

/**
 * Schema for resuming a training run that already passed `submit fal training`
 * but whose worker process died before publishing the final `ready` event.
 *
 * All required fields can be sourced from `metadata.training` on the persons
 * record after the original worker reported `phase: polling-training` (and
 * therefore wrote `providerJobId`, `trainingStartedAt`, etc.).
 */
export const resumeFalZibLoraTrainingSchema = z.object({
	datasetUrl: z.string().min(1).nullable().optional(),
	debugCorrelationId: z.string().trim().min(1).optional(),
	genderHint: z.string().trim().min(1).nullable().optional(),
	outputName: z.string().trim().min(1),
	personId: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	providerJobId: z.string().trim().min(1),
	referenceImageCount: z.number().int().nonnegative(),
	referenceImageTargetCount: z.number().int().positive(),
	referenceImageUrls: z.array(z.string()).default([]),
	trainingRunId: z.string().trim().min(1),
	trainingStartedAt: z.string().min(1),
	trainingSteps: z.number().int().positive(),
	triggerWord: z.string().trim().min(1),
});

type ResumeInput = z.input<typeof resumeFalZibLoraTrainingSchema>;

type TrainingEventStatus =
	| "queued"
	| "generating"
	| "training"
	| "publishing"
	| "ready"
	| "failed";

function sanitizeSegment(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/giu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
}

/**
 * Builds the LoRA trigger word. We deliberately prefix with `ohwx` (a classic
 * DreamBooth rare token) so the trigger is something the base model has no
 * prior associations with — this keeps the model from "filling in" its own
 * idea of what a person with that name should look like and forces all
 * identity weight onto the LoRA itself.
 */
function buildDefaultTriggerWord(slug: string) {
	const sanitized = sanitizeSegment(slug).replace(/-/gu, "_");
	const stem = sanitized.length > 0 ? sanitized : "person";
	return `ohwx_${stem}`.slice(0, 60);
}

const FEMALE_PATTERNS =
	/\b(woman|girl|female|женщина|девушка|девочка|she|her)\b/i;
const MALE_PATTERNS = /\b(man|boy|male|мужчина|парень|мальчик|he|his)\b/i;

function inferGenderHint(description?: string): string | null {
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

const IDENTITY_PRESERVATION_HINT =
	"exact same face and identity as the reference, identical facial features, identical eyes nose and mouth, identical face shape, photorealistic skin, accurate likeness, do not alter the face";

const IDENTITY_PROMPT_PREFIX =
	"same exact person from the reference image, identical face and identity";

/**
 * Build the prompt for the reference image generator.
 *
 * Pixel-точная идентичность приходит из самого референса (image_urls), поэтому
 * мы намеренно НЕ подмешиваем сюда пользовательское `description` — оно обычно
 * содержит детали внешности/одежды, которые конкурируют с реальной фотографией
 * за внимание модели и провоцируют дрейф черт лица.
 *
 * Identity-якорь дублируется в начале и в конце промпта: edit-модели типа
 * flux-2/edit чувствительны к позиции токенов, и одностороннее упоминание
 * (только в конце, как было раньше) терялось среди описания сцены.
 */
function buildVariantPrompt(input: {
	referencePrompt?: string;
	variant: ReferenceVariant;
}) {
	const identitySuffix = input.referencePrompt?.trim().length
		? `${input.referencePrompt.trim()}, ${IDENTITY_PRESERVATION_HINT}`
		: IDENTITY_PRESERVATION_HINT;
	return `${IDENTITY_PROMPT_PREFIX}, ${input.variant.prompt}, ${identitySuffix}`;
}

function buildVariantCaption(input: {
	genderHint: string | null;
	triggerWord: string;
	variant: ReferenceVariant;
}) {
	const subject = input.genderHint
		? `${input.triggerWord} ${input.genderHint}`
		: input.triggerWord;
	return `a photo of ${subject}, ${input.variant.caption}`;
}

function buildOriginalPhotoCaption(input: {
	genderHint: string | null;
	slot: OriginalPhotoSlot;
	triggerWord: string;
}) {
	const subject = input.genderHint
		? `${input.triggerWord} ${input.genderHint}`
		: input.triggerWord;
	return `a photo of ${subject}, ${input.slot.caption}`;
}

function clampProgressPct(value: number) {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function buildGeneratingProgress(completedImages: number) {
	return clampProgressPct(10 + (completedImages / TOTAL_DATASET_COUNT) * 45);
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError =
				error instanceof Error ? error : new Error("Unknown operation failure");
			if (attempt < DEFAULT_RETRY_ATTEMPTS) {
				await sleep(DEFAULT_RETRY_DELAY_MS);
			}
		}
	}
	throw lastError ?? new Error("Operation failed");
}

async function ensureSuccessfulResponse(
	response: Response,
	label: string
): Promise<void> {
	if (response.ok) {
		return;
	}

	let detail = "";

	try {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			const body = (await response.json()) as Record<string, unknown>;
			detail =
				(typeof body.error === "string" && body.error) ||
				(typeof body.message === "string" && body.message) ||
				JSON.stringify(body);
		} else {
			detail = (await response.text()).trim();
		}
	} catch {
		detail = "";
	}

	const statusSuffix = response.statusText ? ` ${response.statusText}` : "";
	const detailSuffix = detail ? `: ${detail}` : "";
	throw new Error(
		`${label} failed (${response.status}${statusSuffix})${detailSuffix}`
	);
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

interface FalSubmitResult {
	request_id: string;
	response_url?: string;
	status_url?: string;
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
	pollMs: number,
	options?: {
		onStatus?: (input: { elapsedMs: number; status: string }) => Promise<void>;
	}
): Promise<Record<string, unknown>> {
	const statusUrl =
		submit.status_url ??
		`${FAL_QUEUE_BASE}/${model}/requests/${submit.request_id}/status`;
	const responseUrl =
		submit.response_url ??
		`${FAL_QUEUE_BASE}/${model}/requests/${submit.request_id}`;

	const deadline = Date.now() + timeoutMs;
	const startedAt = Date.now();
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
		await options?.onStatus?.({
			elapsedMs: Date.now() - startedAt,
			status: status.status,
		});
		await sleep(pollMs);
	}
	throw new Error(`fal job timed out after ${timeoutMs}ms`);
}

/**
 * Один проход flux-2/edit. Возвращает URL сгенерированного изображения или
 * `null`, если модель ничего не вернула (бывает при внутренних ошибках fal).
 * Внешний retry стоит в `generateReferenceImageFalWithRetry` — он умеет
 * перевызывать саму генерацию, а не только сетевой запрос.
 */
async function generateReferenceImageFalOnce(
	apiKey: string,
	imageUrl: string,
	prompt: string
): Promise<string | null> {
	const submit = await falSubmit(apiKey, FLUX_REFERENCE_EDIT_MODEL, {
		enable_prompt_expansion: false,
		guidance_scale: IDENTITY_GUIDANCE_SCALE,
		image_size: "portrait_4_3",
		image_urls: [imageUrl],
		negative_prompt: IDENTITY_NEGATIVE_PROMPT,
		num_images: 1,
		num_inference_steps: IDENTITY_INFERENCE_STEPS,
		output_format: "jpeg",
		prompt,
	});
	const result = await falPollUntilDone(
		apiKey,
		submit,
		FLUX_REFERENCE_EDIT_MODEL,
		DEFAULT_DATASET_TIMEOUT_MS,
		DEFAULT_DATASET_POLL_MS
	);
	const images = result.images as Array<{ url?: string }> | undefined;
	return images?.[0]?.url ?? null;
}

async function generateReferenceImageFal(
	apiKey: string,
	imageUrl: string,
	prompt: string
): Promise<string> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
		try {
			const url = await generateReferenceImageFalOnce(apiKey, imageUrl, prompt);
			if (url) {
				return url;
			}
			lastError = new Error("fal flux-2/edit returned no images");
		} catch (error) {
			lastError =
				error instanceof Error
					? error
					: new Error("fal flux-2/edit request failed");
		}
		if (attempt < DEFAULT_RETRY_ATTEMPTS) {
			await sleep(DEFAULT_RETRY_DELAY_MS);
		}
	}
	throw lastError ?? new Error("fal flux-2/edit failed after retries");
}

export class FalZibLoraTrainingRunner {
	private readonly apiKey: string;
	private readonly personsApiBaseUrl?: string;
	private readonly trainingControlToken: string;
	private readonly s3Config?: S3StorageConfig;
	private readonly logger: Pick<Console, "info" | "error">;
	private readonly eventPublisher: EventPublisher | null;

	constructor(options: {
		apiKey: string;
		eventPublisher?: EventPublisher | null;
		personsApiBaseUrl?: string;
		trainingControlToken: string;
		s3Config?: S3StorageConfig;
		logger?: Pick<Console, "info" | "error">;
	}) {
		this.apiKey = options.apiKey;
		this.personsApiBaseUrl = options.personsApiBaseUrl;
		this.trainingControlToken = options.trainingControlToken;
		this.s3Config = options.s3Config;
		this.logger = options.logger ?? console;
		this.eventPublisher = options.eventPublisher ?? null;
	}

	private async sendTrainingEvent(input: {
		personId: string;
		event: {
			assetReleaseId?: string | null;
			completedAt?: string | null;
			datasetUrl?: string | null;
			datasetZipSizeBytes?: number | null;
			debug?: Record<string, unknown>;
			debugCorrelationId?: string | null;
			errorSummary?: string | null;
			failedAt?: string | null;
			lastEventAt?: string | null;
			loraUrl?: string | null;
			phase?: string | null;
			progressPct?: number | null;
			provider?: string | null;
			providerJobId?: string | null;
			providerRequestId?: string | null;
			providerStatus?: string | null;
			referenceImageCount?: number | null;
			referenceImageTargetCount?: number | null;
			referenceImageUrls?: string[];
			status: TrainingEventStatus;
			trainingElapsedMs?: number | null;
			trainingRunId?: string | null;
			trainingStartedAt?: string | null;
			trainingSteps?: number | null;
			triggerWord?: string | null;
			uploadMethod?: string | null;
		};
	}) {
		if (this.eventPublisher) {
			await this.eventPublisher.publishPersonLoraTrainingUpdated({
				context: {
					personId: input.personId,
					trainingRunId: input.event.trainingRunId ?? null,
				},
				event: input.event,
			});
			return;
		}

		if (!this.personsApiBaseUrl) {
			throw new Error(
				"PERSONS_API_URL or KAFKA_BROKERS is required to publish training events"
			);
		}

		await retry(async () => {
			const response = await fetch(
				`${this.personsApiBaseUrl}/api/internal/lora-trainings`,
				{
					body: JSON.stringify({
						context: { personId: input.personId },
						event: input.event,
					}),
					headers: {
						authorization: `Bearer ${this.trainingControlToken}`,
						"content-type": "application/json",
					},
					method: "POST",
				}
			);
			await ensureSuccessfulResponse(response, "Training callback");
		});
	}

	async run(input: StartInput) {
		const parsed = startFalZibLoraTrainingSchema.parse(input);
		const triggerWord =
			parsed.triggerWord ?? buildDefaultTriggerWord(parsed.personSlug);
		const genderHint = inferGenderHint(parsed.description);
		const startedAt = new Date().toISOString();

		try {
			const outputName =
				parsed.outputName ??
				`${sanitizeSegment(parsed.personSlug)}-zib-lora-${Date.now()}`;

			this.logger.info("fal-zib-lora.generating-references", {
				personId: parsed.personId,
				count: REFERENCE_COUNT,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						originalPhotoDuplicates: ORIGINAL_PHOTO_DUPLICATES,
						referenceModel: FLUX_REFERENCE_EDIT_MODEL,
						referenceVariantCount: REFERENCE_COUNT,
						sourceReferencePhotoUrl: parsed.referencePhotoUrl,
						trainingModel: "fal-ai/z-image-trainer",
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: startedAt,
					phase: "generating-references",
					progressPct: buildGeneratingProgress(ORIGINAL_DATASET_COUNT),
					provider: "fal",
					referenceImageCount: ORIGINAL_DATASET_COUNT,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			const generatedReferences: Array<{
				caption: string;
				url: string;
			}> = [];
			for (const variant of REFERENCE_DATASET_VARIANTS) {
				const prompt = buildVariantPrompt({
					referencePrompt: parsed.referencePrompt,
					variant,
				});
				const caption = buildVariantCaption({
					genderHint,
					triggerWord,
					variant,
				});
				const url = await generateReferenceImageFal(
					this.apiKey,
					parsed.referencePhotoUrl,
					prompt
				);
				generatedReferences.push({ caption, url });
				this.logger.info("fal-zib-lora.reference-generated", {
					personId: parsed.personId,
					index: generatedReferences.length,
					total: REFERENCE_COUNT,
				});

				await this.sendTrainingEvent({
					personId: parsed.personId,
					event: {
						debugCorrelationId: parsed.debugCorrelationId,
						lastEventAt: new Date().toISOString(),
						phase: "generating-references",
						progressPct: buildGeneratingProgress(
							generatedReferences.length + ORIGINAL_DATASET_COUNT
						),
						provider: "fal",
						referenceImageCount:
							generatedReferences.length + ORIGINAL_DATASET_COUNT,
						referenceImageTargetCount: TOTAL_DATASET_COUNT,
						referenceImageUrls: [
							parsed.referencePhotoUrl,
							...generatedReferences.map((entry) => entry.url),
						],
						status: "generating",
						trainingRunId: parsed.trainingRunId,
						triggerWord,
					},
				});
			}

			this.logger.info("fal-zib-lora.downloading-dataset", {
				personId: parsed.personId,
				originalDuplicates: ORIGINAL_DATASET_COUNT,
				syntheticVariants: generatedReferences.length,
			});

			const refPhoto = await downloadImageAsset(parsed.referencePhotoUrl);
			const generatedImages = await Promise.all(
				generatedReferences.map(async (entry, index) => {
					const image = await downloadImageAsset(entry.url);
					return {
						caption: entry.caption,
						data: image.data,
						name: `${String(index + ORIGINAL_DATASET_COUNT).padStart(3, "0")}${image.extension}`,
					};
				})
			);

			const zipFiles: Array<{ name: string; data: Uint8Array }> = [];
			for (const [slotIndex, slot] of ORIGINAL_PHOTO_SLOTS.entries()) {
				const baseName = String(slotIndex).padStart(3, "0");
				zipFiles.push({
					name: `${baseName}${refPhoto.extension}`,
					data: refPhoto.data,
				});
				zipFiles.push({
					name: `${baseName}.txt`,
					data: new TextEncoder().encode(
						buildOriginalPhotoCaption({ genderHint, slot, triggerWord })
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

			const zipData = buildZipFromBuffers(zipFiles);
			if (!this.s3Config) {
				throw new Error("S3 config is required to persist LoRA dataset");
			}

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debugCorrelationId: parsed.debugCorrelationId,
					datasetZipSizeBytes: zipData.length,
					lastEventAt: new Date().toISOString(),
					phase: "uploading-dataset",
					progressPct: 62,
					provider: "fal",
					referenceImageCount:
						generatedReferences.length + ORIGINAL_DATASET_COUNT,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
					uploadMethod: "s3",
				},
			});

			this.logger.info("fal-zib-lora.uploading-dataset", {
				personId: parsed.personId,
				zipSizeBytes: zipData.length,
				method: "s3",
			});

			const datasetUrl = await uploadZipToS3(
				zipData,
				`${outputName}-dataset.zip`,
				this.s3Config
			);

			const defaultCaption = buildOriginalPhotoCaption({
				genderHint,
				slot: ORIGINAL_PHOTO_SLOTS[0],
				triggerWord,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					datasetUrl,
					datasetZipSizeBytes: zipData.length,
					debug: {
						defaultCaption,
						originalPhotoDuplicates: ORIGINAL_DATASET_COUNT,
						outputName,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "starting-training",
					progressPct: 70,
					provider: "fal",
					referenceImageCount:
						generatedReferences.length + ORIGINAL_DATASET_COUNT,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					referenceImageUrls: [
						parsed.referencePhotoUrl,
						...generatedReferences.map((entry) => entry.url),
					],
					status: "training",
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt: new Date().toISOString(),
					trainingSteps:
						env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS,
					triggerWord,
					uploadMethod: "s3",
				},
			});

			const trainingSteps =
				env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS;

			this.logger.info("fal-zib-lora.starting-training", {
				personId: parsed.personId,
				steps: trainingSteps,
			});
			const trainingModel = "fal-ai/z-image-trainer";
			const trainingStartedAt = new Date().toISOString();
			const trainingStartedMs = Date.now();
			const trainingSubmit = await falSubmit(this.apiKey, trainingModel, {
				image_data_url: datasetUrl,
				steps: trainingSteps,
				default_caption: defaultCaption,
				learning_rate: 0.0001,
				training_type: "content",
			});

			this.logger.info("fal-zib-lora.training-started", {
				personId: parsed.personId,
				requestId: trainingSubmit.request_id,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						falStatusUrl:
							trainingSubmit.status_url ??
							`${FAL_QUEUE_BASE}/${trainingModel}/requests/${trainingSubmit.request_id}/status`,
						falResponseUrl:
							trainingSubmit.response_url ??
							`${FAL_QUEUE_BASE}/${trainingModel}/requests/${trainingSubmit.request_id}`,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "polling-training",
					progressPct: 76,
					provider: "fal",
					providerJobId: trainingSubmit.request_id,
					providerRequestId: trainingSubmit.request_id,
					providerStatus: "IN_PROGRESS",
					status: "training",
					trainingElapsedMs: 0,
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt,
					trainingSteps,
					triggerWord,
				},
			});

			await this.pollTrainingAndPublish({
				datasetUrl,
				debugCorrelationId: parsed.debugCorrelationId,
				genderHint,
				outputName,
				personId: parsed.personId,
				providerJobId: trainingSubmit.request_id,
				referenceImageCount:
					generatedReferences.length + ORIGINAL_DATASET_COUNT,
				referenceImageTargetCount: TOTAL_DATASET_COUNT,
				referenceImageUrls: [
					parsed.referencePhotoUrl,
					...generatedReferences.map((entry) => entry.url),
				],
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt,
				trainingStartedMs,
				trainingSteps,
				triggerWord,
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error ? error.message : "Fal ZIB LoRA training failed";
			this.logger.error("fal-zib-lora.failed", {
				personId: parsed.personId,
				error: errorSummary,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debugCorrelationId: parsed.debugCorrelationId,
					errorSummary,
					failedAt: new Date().toISOString(),
					lastEventAt: new Date().toISOString(),
					phase: "failed",
					provider: "fal",
					status: "failed",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});
			throw error;
		}
	}

	/**
	 * Resume a training run that crashed AFTER the fal training job was
	 * submitted. We don't redo dataset generation or re-submit the job — we
	 * simply attach to the existing fal `request_id` and finish the workflow
	 * (poll → cache weights → publish ready).
	 *
	 * Safe to call concurrently with the original worker thanks to
	 * `applyLoraTrainingEvent`'s `currentTrainingRunId === callbackTrainingRunId`
	 * guard, but the recovery driver should still serialise via an idempotency
	 * lock to avoid wasting fal status calls.
	 */
	async resumeFromProviderJob(input: ResumeInput) {
		const parsed = resumeFalZibLoraTrainingSchema.parse(input);
		const trainingStartedMs = Date.parse(parsed.trainingStartedAt);
		if (!Number.isFinite(trainingStartedMs)) {
			throw new Error(
				`Invalid trainingStartedAt for resume: ${parsed.trainingStartedAt}`
			);
		}

		this.logger.info("fal-zib-lora.resume", {
			personId: parsed.personId,
			providerJobId: parsed.providerJobId,
			trainingRunId: parsed.trainingRunId,
		});

		try {
			await this.pollTrainingAndPublish({
				datasetUrl: parsed.datasetUrl ?? null,
				debugCorrelationId: parsed.debugCorrelationId,
				extraReadyDebug: {
					recovered: true,
					recoveredAt: new Date().toISOString(),
				},
				genderHint: parsed.genderHint ?? null,
				outputName: parsed.outputName,
				personId: parsed.personId,
				providerJobId: parsed.providerJobId,
				referenceImageCount: parsed.referenceImageCount,
				referenceImageTargetCount: parsed.referenceImageTargetCount,
				referenceImageUrls: parsed.referenceImageUrls ?? [],
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt: parsed.trainingStartedAt,
				trainingStartedMs,
				trainingSteps: parsed.trainingSteps,
				triggerWord: parsed.triggerWord,
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error
					? error.message
					: "Fal ZIB LoRA training resume failed";
			this.logger.error("fal-zib-lora.resume-failed", {
				personId: parsed.personId,
				error: errorSummary,
				providerJobId: parsed.providerJobId,
				trainingRunId: parsed.trainingRunId,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						recovered: true,
						recoveredAt: new Date().toISOString(),
					},
					debugCorrelationId: parsed.debugCorrelationId,
					errorSummary,
					failedAt: new Date().toISOString(),
					lastEventAt: new Date().toISOString(),
					phase: "failed",
					provider: "fal",
					providerJobId: parsed.providerJobId,
					status: "failed",
					trainingRunId: parsed.trainingRunId,
					triggerWord: parsed.triggerWord,
				},
			});
			throw error;
		}
	}

	private async pollTrainingAndPublish(input: {
		datasetUrl?: string | null;
		debugCorrelationId?: string;
		extraReadyDebug?: Record<string, unknown>;
		genderHint: string | null;
		outputName: string;
		personId: string;
		providerJobId: string;
		referenceImageCount: number;
		referenceImageTargetCount: number;
		referenceImageUrls: string[];
		trainingRunId: string;
		trainingStartedAt: string;
		trainingStartedMs: number;
		trainingSteps: number;
		triggerWord: string;
	}) {
		const trainingModel = "fal-ai/z-image-trainer";
		const submit: FalSubmitResult = {
			request_id: input.providerJobId,
			response_url: `${FAL_QUEUE_BASE}/${trainingModel}/requests/${input.providerJobId}`,
			status_url: `${FAL_QUEUE_BASE}/${trainingModel}/requests/${input.providerJobId}/status`,
		};

		const trainingResult = await falPollUntilDone(
			this.apiKey,
			submit,
			trainingModel,
			DEFAULT_TRAINING_TIMEOUT_MS,
			DEFAULT_TRAINING_POLL_MS,
			{
				onStatus: async (status) => {
					await this.sendTrainingEvent({
						personId: input.personId,
						event: {
							debugCorrelationId: input.debugCorrelationId,
							lastEventAt: new Date().toISOString(),
							phase: "polling-training",
							progressPct: 76,
							provider: "fal",
							providerJobId: input.providerJobId,
							providerRequestId: input.providerJobId,
							providerStatus: status.status,
							referenceImageCount: input.referenceImageCount,
							referenceImageTargetCount: input.referenceImageTargetCount,
							status: "training",
							trainingElapsedMs: status.elapsedMs,
							trainingRunId: input.trainingRunId,
							trainingStartedAt: input.trainingStartedAt,
							trainingSteps: input.trainingSteps,
							triggerWord: input.triggerWord,
						},
					});
				},
			}
		);

		const diffusersLoraFile = trainingResult.diffusers_lora_file as
			| { url?: string }
			| undefined;
		const loraUrl = diffusersLoraFile?.url;
		if (!loraUrl) {
			throw new Error(
				"ZIB LoRA training completed but no weights URL was returned"
			);
		}

		this.logger.info("fal-zib-lora.training-completed", {
			loraUrl,
			personId: input.personId,
		});

		if (!this.s3Config) {
			throw new Error("S3 config is required to persist LoRA weights");
		}

		await this.sendTrainingEvent({
			personId: input.personId,
			event: {
				debug: { providerLoraUrl: loraUrl },
				debugCorrelationId: input.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				phase: "publishing-lora",
				progressPct: 92,
				provider: "fal",
				providerJobId: input.providerJobId,
				providerRequestId: input.providerJobId,
				providerStatus: "COMPLETED",
				status: "publishing",
				trainingElapsedMs: Date.now() - input.trainingStartedMs,
				trainingRunId: input.trainingRunId,
				trainingStartedAt: input.trainingStartedAt,
				trainingSteps: input.trainingSteps,
				triggerWord: input.triggerWord,
			},
		});

		const persistedLora = await persistLoraWeightsToS3(
			{
				filename: `${sanitizeSegment(input.outputName)}-${input.trainingRunId.slice(0, 8)}.safetensors`,
				sourceUrl: loraUrl,
			},
			this.s3Config
		);

		this.logger.info("fal-zib-lora.lora-persisted", {
			personId: input.personId,
			sizeBytes: persistedLora.sizeBytes,
			url: persistedLora.url,
		});

		await this.sendTrainingEvent({
			personId: input.personId,
			event: {
				completedAt: new Date().toISOString(),
				datasetUrl: input.datasetUrl ?? undefined,
				debug: {
					...(input.extraReadyDebug ?? {}),
					genderHint: input.genderHint,
					loraStorageKey: persistedLora.key,
					loraStorageSizeBytes: persistedLora.sizeBytes,
					persistedLoraUrl: persistedLora.url,
					providerLoraUrl: loraUrl,
					trainingResult,
				},
				debugCorrelationId: input.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				loraUrl: persistedLora.url,
				phase: "ready",
				progressPct: 100,
				provider: "fal",
				providerJobId: input.providerJobId,
				providerRequestId: input.providerJobId,
				providerStatus: "COMPLETED",
				referenceImageCount: input.referenceImageCount,
				referenceImageTargetCount: input.referenceImageTargetCount,
				referenceImageUrls: input.referenceImageUrls,
				status: "ready",
				trainingElapsedMs: Date.now() - input.trainingStartedMs,
				trainingRunId: input.trainingRunId,
				trainingStartedAt: input.trainingStartedAt,
				trainingSteps: input.trainingSteps,
				triggerWord: input.triggerWord,
				uploadMethod: "s3",
			},
		});
	}
}
