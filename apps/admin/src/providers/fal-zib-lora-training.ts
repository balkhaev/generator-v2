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
const DEFAULT_TRAINING_STEPS = 1000;
const DEFAULT_TRAINING_POLL_MS = 30_000;
const DEFAULT_TRAINING_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_DATASET_POLL_MS = 5000;
const DEFAULT_DATASET_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const FLUX_REFERENCE_EDIT_MODEL = "fal-ai/flux-2/edit";
const fileExtensionPattern = /\.[^.]+$/u;

interface ReferenceVariant {
	caption: string;
	prompt: string;
}

/**
 * Diverse training set covering multiple framings, angles, poses, expressions,
 * lighting setups, environments and outfits. Variety matters more than
 * count for LoRA identity training: the model should learn the face, not a
 * pose or wardrobe. Captions describe everything except identity so the
 * trainer attributes those features to the prompt rather than the trigger.
 */
const REFERENCE_DATASET_VARIANTS: readonly ReferenceVariant[] = [
	{
		caption:
			"close-up beauty headshot, soft north-window light, neutral grey backdrop, eyes to camera, relaxed expression",
		prompt:
			"close-up beauty headshot, soft diffused north-window light, neutral grey backdrop, eyes to camera, relaxed neutral expression",
	},
	{
		caption:
			"three-quarter portrait, golden hour sunlight, blurred park greenery in background, gentle smile, casual cotton t-shirt",
		prompt:
			"three-quarter outdoor portrait, warm golden hour sunlight, blurred park greenery in the background, gentle smile, casual cotton t-shirt",
	},
	{
		caption:
			"full-body environmental shot, modern urban sidewalk, overcast soft daylight, walking pose, denim jacket and jeans",
		prompt:
			"full-body environmental shot, modern urban sidewalk, overcast soft daylight, mid-stride walking pose, denim jacket and dark jeans",
	},
	{
		caption:
			"profile side portrait, hard studio rim light, dark seamless background, looking off to the left, calm expression",
		prompt:
			"strict side profile portrait, hard rim light from behind, dark seamless studio background, looking off to the left, calm expression",
	},
	{
		caption:
			"candid laughing portrait, sunny summer park, dappled afternoon light through leaves, head slightly tilted back, white linen shirt",
		prompt:
			"candid laughing portrait, sunny summer park, dappled afternoon sunlight through leaves, head slightly tilted back, plain white linen shirt",
	},
	{
		caption:
			"dramatic chiaroscuro headshot, single hard key light from upper left, deep black background, serious expression, half face in shadow",
		prompt:
			"dramatic chiaroscuro headshot, single hard key light from upper left, deep black background, serious expression, half of face in shadow",
	},
	{
		caption:
			"low-angle medium shot looking up, glass office building behind, blue hour twilight, confident posture, charcoal blazer",
		prompt:
			"low-angle medium shot looking up at subject, modern glass office building in background, blue hour twilight, confident upright posture, charcoal blazer",
	},
	{
		caption:
			"cinematic medium shot, rainy night city street, neon signage reflections on wet pavement, contemplative expression, dark hooded jacket",
		prompt:
			"cinematic medium shot, rainy night city street with neon signage reflections on wet pavement, contemplative expression, dark hooded jacket, color grade with teal and magenta accents",
	},
	{
		caption:
			"editorial fashion half-body, clean white cyclorama, soft beauty dish lighting, hand on hip, structured beige blazer",
		prompt:
			"editorial fashion half-body shot, clean white cyclorama studio, soft beauty dish lighting from front, hand resting on hip, structured beige blazer",
	},
	{
		caption:
			"relaxed seated portrait, cozy living room couch, warm lamp ambient light, holding a ceramic mug, oversized knit sweater",
		prompt:
			"relaxed seated portrait on a cozy living room couch, warm lamp ambient light, hands cradling a ceramic mug, oversized cream knit sweater",
	},
	{
		caption:
			"windswept beach portrait at sunset, warm orange sky, hair blown to one side, calm expression, casual linen shirt",
		prompt:
			"windswept three-quarter portrait on a beach at sunset, warm orange and pink sky, hair blowing across one side of face, calm expression, casual linen shirt",
	},
	{
		caption:
			"bookstore aisle medium shot, warm tungsten interior lighting, head turned to camera, slight curious smile, simple sweater and round glasses",
		prompt:
			"medium shot in a bookstore aisle between tall shelves, warm tungsten interior lighting, head turned toward camera, slight curious smile, simple sweater and thin round glasses",
	},
	{
		caption:
			"moody overhead spotlight portrait, single hard top light, deep shadow under chin, downcast eyes, monochromatic black tank top",
		prompt:
			"moody overhead spotlight portrait, single hard top light, deep shadow under the chin, downcast eyes, simple monochromatic black tank top",
	},
	{
		caption:
			"high-key bathroom mirror portrait, fresh morning daylight, natural skin without makeup, slight smile, plain white tee",
		prompt:
			"high-key bathroom mirror portrait, fresh morning daylight, natural untouched skin, no visible makeup, slight smile, plain white t-shirt",
	},
	{
		caption:
			"autumn park three-quarter shot, soft overcast light, golden fallen leaves on the ground, knit scarf, warm earthy palette",
		prompt:
			"three-quarter shot in an autumn park, soft overcast diffuse light, blurred golden leaves on the ground, woolen knit scarf, warm earthy color palette",
	},
	{
		caption:
			"extreme close-up showing skin texture and freckles, soft window light from the right, faint smirk, plain background",
		prompt:
			"extreme close-up of the face showing realistic skin texture and pores, soft north window light from camera-right, faint smirk, plain out-of-focus neutral background",
	},
	{
		caption:
			"nighttime street portrait, glowing neon shop signs, magenta and teal color cast, hands in pockets, black leather jacket",
		prompt:
			"nighttime street portrait, glowing neon shop signs in the background, magenta and teal color cast on subject, hands tucked into pockets, black leather jacket",
	},
	{
		caption:
			"high-angle top-down headshot, lying on grass, soft natural midday light, calm expression, hair fanned out around the head",
		prompt:
			"high-angle top-down headshot, subject lying on a patch of fresh grass, soft natural midday light, calm expression with eyes to camera, hair fanned out around the head",
	},
	{
		caption:
			"professional corporate headshot, solid medium grey background, soft front clamshell lighting, friendly closed-mouth smile, dark navy collared shirt",
		prompt:
			"professional corporate headshot, solid medium grey backdrop, soft frontal clamshell lighting, friendly closed-mouth smile, dark navy collared shirt",
	},
	{
		caption:
			"environmental cafe portrait, large window soft daylight, wooden interior bokeh, hands resting on table, beige cardigan",
		prompt:
			"environmental cafe portrait, soft daylight from a large window, warm wooden interior bokeh, hands resting on a small table, beige cardigan over a simple top",
	},
] as const;

const REFERENCE_COUNT = REFERENCE_DATASET_VARIANTS.length;

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
	"identical facial features and identity to the reference image, photorealistic, natural skin, accurate likeness";

/**
 * Build the prompt for the reference image generator. The pixel-perfect
 * identity comes from the reference image itself (passed as image_urls), so
 * we intentionally avoid mixing in the user-provided description (which usually
 * also contains outfit and scene details) to keep variant diversity high.
 */
function buildVariantPrompt(input: {
	referencePrompt?: string;
	variant: ReferenceVariant;
}) {
	const identityHint = input.referencePrompt?.trim().length
		? `${input.referencePrompt.trim()}, ${IDENTITY_PRESERVATION_HINT}`
		: IDENTITY_PRESERVATION_HINT;
	return `${input.variant.prompt}, ${identityHint}`;
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

function buildReferencePhotoCaption(input: {
	genderHint: string | null;
	triggerWord: string;
}) {
	const subject = input.genderHint
		? `${input.triggerWord} ${input.genderHint}`
		: input.triggerWord;
	return `a photo of ${subject}, candid reference photograph`;
}

function clampProgressPct(value: number) {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function buildGeneratingProgress(completedImages: number) {
	return clampProgressPct(10 + (completedImages / (REFERENCE_COUNT + 1)) * 45);
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

async function generateReferenceImageFal(
	apiKey: string,
	imageUrl: string,
	prompt: string
): Promise<string> {
	const submit = await falSubmit(apiKey, FLUX_REFERENCE_EDIT_MODEL, {
		enable_prompt_expansion: false,
		guidance_scale: 2.5,
		image_size: "portrait_4_3",
		image_urls: [imageUrl],
		num_images: 1,
		num_inference_steps: 28,
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
	const url = images?.[0]?.url;
	if (!url) {
		throw new Error("fal flux/dev returned no images");
	}
	return url;
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
			parsed.triggerWord ??
			sanitizeSegment(parsed.personSlug).replace(/-/gu, "_");
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
						referenceModel: FLUX_REFERENCE_EDIT_MODEL,
						referenceVariantCount: REFERENCE_COUNT,
						sourceReferencePhotoUrl: parsed.referencePhotoUrl,
						trainingModel: "fal-ai/z-image-trainer",
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: startedAt,
					phase: "generating-references",
					progressPct: buildGeneratingProgress(1),
					provider: "fal",
					referenceImageCount: 1,
					referenceImageTargetCount: REFERENCE_COUNT + 1,
					status: "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			const generatedReferences: Array<{ caption: string; url: string }> = [];
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
							generatedReferences.length + 1
						),
						provider: "fal",
						referenceImageCount: generatedReferences.length + 1,
						referenceImageTargetCount: REFERENCE_COUNT + 1,
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
				imageCount: generatedReferences.length + 1,
			});

			const refPhoto = await downloadImageAsset(parsed.referencePhotoUrl);
			const referencePhotoCaption = buildReferencePhotoCaption({
				genderHint,
				triggerWord,
			});
			const generatedImages = await Promise.all(
				generatedReferences.map(async (entry, index) => {
					const image = await downloadImageAsset(entry.url);
					return {
						caption: entry.caption,
						data: image.data,
						name: `${String(index + 1).padStart(3, "0")}${image.extension}`,
					};
				})
			);

			const zipFiles: Array<{ name: string; data: Uint8Array }> = [
				{ name: `000${refPhoto.extension}`, data: refPhoto.data },
				{
					name: "000.txt",
					data: new TextEncoder().encode(referencePhotoCaption),
				},
			];

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
					referenceImageCount: generatedReferences.length + 1,
					referenceImageTargetCount: REFERENCE_COUNT + 1,
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

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					datasetUrl,
					datasetZipSizeBytes: zipData.length,
					debug: {
						defaultCaption: referencePhotoCaption,
						outputName,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "starting-training",
					progressPct: 70,
					provider: "fal",
					referenceImageCount: generatedReferences.length + 1,
					referenceImageTargetCount: REFERENCE_COUNT + 1,
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
				default_caption: referencePhotoCaption,
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

			const trainingResult = await falPollUntilDone(
				this.apiKey,
				trainingSubmit,
				trainingModel,
				DEFAULT_TRAINING_TIMEOUT_MS,
				DEFAULT_TRAINING_POLL_MS,
				{
					onStatus: async (status) => {
						await this.sendTrainingEvent({
							personId: parsed.personId,
							event: {
								debugCorrelationId: parsed.debugCorrelationId,
								lastEventAt: new Date().toISOString(),
								phase: "polling-training",
								progressPct: 76,
								provider: "fal",
								providerJobId: trainingSubmit.request_id,
								providerRequestId: trainingSubmit.request_id,
								providerStatus: status.status,
								status: "training",
								trainingElapsedMs: status.elapsedMs,
								trainingRunId: parsed.trainingRunId,
								trainingStartedAt,
								trainingSteps,
								triggerWord,
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
				personId: parsed.personId,
				loraUrl,
			});

			if (!this.s3Config) {
				throw new Error("S3 config is required to persist LoRA weights");
			}

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						providerLoraUrl: loraUrl,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "publishing-lora",
					progressPct: 92,
					provider: "fal",
					providerJobId: trainingSubmit.request_id,
					providerRequestId: trainingSubmit.request_id,
					providerStatus: "COMPLETED",
					status: "publishing",
					trainingElapsedMs: Date.now() - trainingStartedMs,
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt,
					trainingSteps,
					triggerWord,
				},
			});

			const persistedLora = await persistLoraWeightsToS3(
				{
					filename: `${sanitizeSegment(outputName)}-${parsed.trainingRunId.slice(0, 8)}.safetensors`,
					sourceUrl: loraUrl,
				},
				this.s3Config
			);

			this.logger.info("fal-zib-lora.lora-persisted", {
				personId: parsed.personId,
				sizeBytes: persistedLora.sizeBytes,
				url: persistedLora.url,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					completedAt: new Date().toISOString(),
					datasetUrl,
					debug: {
						genderHint,
						loraStorageKey: persistedLora.key,
						loraStorageSizeBytes: persistedLora.sizeBytes,
						persistedLoraUrl: persistedLora.url,
						providerLoraUrl: loraUrl,
						trainingResult,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					loraUrl: persistedLora.url,
					phase: "ready",
					progressPct: 100,
					provider: "fal",
					providerJobId: trainingSubmit.request_id,
					providerRequestId: trainingSubmit.request_id,
					providerStatus: "COMPLETED",
					referenceImageCount: generatedReferences.length + 1,
					referenceImageTargetCount: REFERENCE_COUNT + 1,
					referenceImageUrls: [
						parsed.referencePhotoUrl,
						...generatedReferences.map((entry) => entry.url),
					],
					status: "ready",
					trainingElapsedMs: Date.now() - trainingStartedMs,
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt,
					trainingSteps,
					triggerWord,
					uploadMethod: "s3",
				},
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
}
