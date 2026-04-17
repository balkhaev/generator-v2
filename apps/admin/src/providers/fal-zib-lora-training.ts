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
const DEFAULT_TRAINING_STEPS = 1500;
const DEFAULT_TRAINING_POLL_MS = 30_000;
const DEFAULT_TRAINING_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_DATASET_POLL_MS = 5000;
const DEFAULT_DATASET_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const FLUX_REFERENCE_EDIT_MODEL = "fal-ai/flux-2/edit";
const fileExtensionPattern = /\.[^.]+$/u;

/**
 * Number of times the original reference photo is duplicated inside the dataset
 * (with different captions). The original is the only ground-truth identity in
 * the set — every synthetic variant adds drift. Weighting it more makes the
 * trainer treat that face as the canonical one.
 */
const ORIGINAL_PHOTO_DUPLICATES = 4;

/**
 * Identity gate threshold (0–100). Synthetic references whose face-similarity
 * score against the source photo falls below this value are regenerated with a
 * fresh seed up to MAX_VARIANT_RETRIES times. Disabled gracefully when no
 * vision-capable judge is configured (XAI_API_KEY not set).
 */
const IDENTITY_GATE_THRESHOLD = 70;
const MAX_VARIANT_RETRIES = 2;

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
] as const satisfies readonly OriginalPhotoSlot[];

/**
 * Dataset for LoRA identity training. Two groups:
 *
 *   1. SCENE variants (full/half-body, environmental) — teach the trainer
 *      that the trigger generalises across lighting, framing, wardrobe and
 *      backgrounds. Selected to be photographically NEUTRAL: no extreme
 *      shadows, no full profiles, no heavy color casts, no top-down/low-angle
 *      framings. Aggressive lighting and angles cause `flux-2/edit` to drift
 *      the face the most, which then poisons the LoRA.
 *
 *   2. FACE-ONLY variants — tight headshots from near-frontal angles on plain
 *      backgrounds. Provide pixel-density on the face so the trainer has
 *      enough signal to anchor identity, not just pose.
 *
 * Captions describe everything EXCEPT identity (no eye color, hair color, etc.)
 * so the trigger word is the only thing left to absorb the face.
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
			"full-body environmental shot, modern urban sidewalk, overcast soft daylight, standing pose, denim jacket and jeans",
		prompt:
			"full-body environmental shot, modern urban sidewalk, overcast soft daylight, relaxed standing pose facing the camera, denim jacket and dark jeans",
	},
	{
		caption:
			"candid laughing portrait, sunny summer park, dappled afternoon light through leaves, head slightly tilted, white linen shirt",
		prompt:
			"candid laughing portrait, sunny summer park, dappled afternoon sunlight through leaves, head slightly tilted, plain white linen shirt, eyes visible to camera",
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
			"bookstore aisle medium shot, warm tungsten interior lighting, head turned to camera, slight curious smile, simple sweater",
		prompt:
			"medium shot in a bookstore aisle between tall shelves, warm tungsten interior lighting, head turned toward camera, slight curious smile, simple sweater",
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
	{
		caption:
			"sunlit kitchen half-body shot, soft morning light from large window, leaning on a marble counter, cream knit sweater",
		prompt:
			"half-body shot in a bright modern kitchen, soft morning daylight from a large window, leaning casually on a marble counter, cream knit sweater, eyes to camera",
	},
	{
		caption:
			"tight frontal headshot, plain off-white background, soft frontal beauty light, eye level, neutral relaxed expression, eyes to camera",
		prompt:
			"tight frontal headshot of the face and shoulders, plain off-white seamless background, soft frontal beauty lighting, eye-level camera, neutral relaxed expression, both eyes clearly visible to camera, sharp focus on face",
	},
	{
		caption:
			"soft three-quarter face turn to camera-left, plain neutral background, even soft daylight, eye level, calm gentle expression",
		prompt:
			"soft three-quarter portrait with the face turned slightly to camera-left at roughly twenty degrees, plain neutral light grey background, even soft daylight, eye-level framing, calm gentle expression, both eyes visible, sharp focus on face",
	},
	{
		caption:
			"soft three-quarter face turn to camera-right, plain neutral background, even soft daylight, eye level, calm gentle expression",
		prompt:
			"soft three-quarter portrait with the face turned slightly to camera-right at roughly twenty degrees, plain neutral light grey background, even soft daylight, eye-level framing, calm gentle expression, both eyes visible, sharp focus on face",
	},
	{
		caption:
			"head and shoulders portrait, plain background, soft overcast light, eye level, gentle natural smile, eyes to camera",
		prompt:
			"head and shoulders portrait, plain neutral background, soft overcast diffuse light, eye-level camera, gentle natural closed-mouth smile, eyes to camera, sharp focus on face",
	},
] as const;

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

async function generateReferenceImageFal(
	apiKey: string,
	imageUrl: string,
	prompt: string,
	options?: { seed?: number }
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
		...(options?.seed === undefined ? {} : { seed: options.seed }),
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

const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_VISION_MODEL = "grok-2-vision-1212";

const FACE_JUDGE_PROMPT = `You are a strict face-identity verifier for a LoRA training dataset.
Compare ONE source reference photo with ONE candidate photo.
Decide whether the candidate is the SAME PERSON as the source — only the face/identity matters.
Ignore differences in pose, framing, lighting, wardrobe, background, expression, hair styling, makeup or color grading.
Reply with ONE compact JSON object and nothing else: {"score": <integer 0-100>, "same_person": <true|false>}.
score = your confidence (0 = obviously different person, 100 = obviously the same person).`;

interface FaceJudge {
	scoreSimilarity(input: {
		candidateImageUrl: string;
		sourceImageUrl: string;
	}): Promise<number>;
}

interface GrokVisionFaceJudgeOptions {
	apiKey: string;
	fetchImpl?: typeof fetch;
	model?: string;
}

const jsonObjectPattern = /\{[\s\S]*?\}/u;

function parseFaceScore(content: string): number {
	const match = content.match(jsonObjectPattern);
	if (!match) {
		throw new Error("Face judge returned no JSON payload");
	}
	const parsed = JSON.parse(match[0]) as { score?: unknown };
	const rawScore = typeof parsed.score === "number" ? parsed.score : Number.NaN;
	if (!Number.isFinite(rawScore)) {
		throw new Error("Face judge returned non-numeric score");
	}
	return Math.max(0, Math.min(100, Math.round(rawScore)));
}

export function createGrokVisionFaceJudge(
	options: GrokVisionFaceJudgeOptions
): FaceJudge {
	const apiKey = options.apiKey.trim();
	if (!apiKey) {
		throw new Error("XAI_API_KEY is required to create face judge");
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const model = options.model ?? DEFAULT_VISION_MODEL;

	return {
		async scoreSimilarity({ candidateImageUrl, sourceImageUrl }) {
			const response = await fetchImpl(`${XAI_BASE_URL}/chat/completions`, {
				body: JSON.stringify({
					messages: [
						{ role: "system", content: FACE_JUDGE_PROMPT },
						{
							role: "user",
							content: [
								{
									type: "image_url",
									image_url: { url: sourceImageUrl, detail: "high" },
								},
								{
									type: "image_url",
									image_url: { url: candidateImageUrl, detail: "high" },
								},
								{
									type: "text",
									text: "Image 1 is the source reference. Image 2 is the candidate. Are they the same person?",
								},
							],
						},
					],
					model,
					temperature: 0,
				}),
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				method: "POST",
			});

			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(
					`Grok vision request failed: ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
				);
			}

			const payload = (await response.json()) as {
				choices?: Array<{ message?: { content?: string | null } }>;
			};
			const content = payload.choices?.[0]?.message?.content?.trim();
			if (!content) {
				throw new Error("Grok vision response was empty");
			}
			return parseFaceScore(content);
		},
	};
}

export class FalZibLoraTrainingRunner {
	private readonly apiKey: string;
	private readonly personsApiBaseUrl?: string;
	private readonly trainingControlToken: string;
	private readonly s3Config?: S3StorageConfig;
	private readonly logger: Pick<Console, "info" | "error">;
	private readonly eventPublisher: EventPublisher | null;
	private readonly faceJudge: FaceJudge | null;

	constructor(options: {
		apiKey: string;
		eventPublisher?: EventPublisher | null;
		faceJudge?: FaceJudge | null;
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
		this.faceJudge = options.faceJudge ?? null;
	}

	/**
	 * Generates ONE reference variant via flux-2/edit and (when a face judge is
	 * configured) verifies that the result still looks like the source person.
	 * Retries up to MAX_VARIANT_RETRIES times with new seeds if the judge
	 * scores below IDENTITY_GATE_THRESHOLD. Returns `null` if every attempt
	 * fails the gate — caller should drop the variant rather than poisoning
	 * the dataset with a wrong face.
	 */
	private async generateReferenceVariantWithGate(input: {
		personId: string;
		prompt: string;
		sourceImageUrl: string;
		variantIndex: number;
	}): Promise<{ score: number | null; url: string } | null> {
		let bestUrl: string | null = null;
		let bestScore = -1;

		for (let attempt = 0; attempt <= MAX_VARIANT_RETRIES; attempt += 1) {
			const seed =
				attempt === 0 ? undefined : Math.floor(Math.random() * 2_000_000_000);
			const url = await generateReferenceImageFal(
				this.apiKey,
				input.sourceImageUrl,
				input.prompt,
				{ seed }
			);

			if (!this.faceJudge) {
				return { score: null, url };
			}

			let score = 0;
			try {
				score = await this.faceJudge.scoreSimilarity({
					candidateImageUrl: url,
					sourceImageUrl: input.sourceImageUrl,
				});
			} catch (error) {
				this.logger.error("fal-zib-lora.face-judge-failed", {
					personId: input.personId,
					variantIndex: input.variantIndex,
					attempt,
					error: error instanceof Error ? error.message : String(error),
				});
				return { score: null, url };
			}

			this.logger.info("fal-zib-lora.face-judge", {
				personId: input.personId,
				variantIndex: input.variantIndex,
				attempt,
				score,
				accepted: score >= IDENTITY_GATE_THRESHOLD,
			});

			if (score > bestScore) {
				bestScore = score;
				bestUrl = url;
			}
			if (score >= IDENTITY_GATE_THRESHOLD) {
				return { score, url };
			}
		}

		if (bestUrl === null) {
			return null;
		}
		this.logger.info("fal-zib-lora.face-judge-fallback", {
			personId: input.personId,
			variantIndex: input.variantIndex,
			bestScore,
		});
		return { score: bestScore, url: bestUrl };
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
				identityGate: this.faceJudge ? "enabled" : "disabled",
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						identityGate: this.faceJudge ? "enabled" : "disabled",
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
				score: number | null;
				url: string;
			}> = [];
			let droppedVariantCount = 0;
			for (const [
				variantIndex,
				variant,
			] of REFERENCE_DATASET_VARIANTS.entries()) {
				const prompt = buildVariantPrompt({
					referencePrompt: parsed.referencePrompt,
					variant,
				});
				const caption = buildVariantCaption({
					genderHint,
					triggerWord,
					variant,
				});
				const result = await this.generateReferenceVariantWithGate({
					personId: parsed.personId,
					prompt,
					sourceImageUrl: parsed.referencePhotoUrl,
					variantIndex,
				});
				if (!result) {
					droppedVariantCount += 1;
					this.logger.info("fal-zib-lora.reference-dropped", {
						personId: parsed.personId,
						variantIndex,
						reason: "identity-gate-failed",
					});
					continue;
				}
				generatedReferences.push({
					caption,
					score: result.score,
					url: result.url,
				});
				this.logger.info("fal-zib-lora.reference-generated", {
					personId: parsed.personId,
					index: generatedReferences.length,
					total: REFERENCE_COUNT,
					score: result.score,
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
				droppedVariants: droppedVariantCount,
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
						droppedVariantCount,
						originalPhotoDuplicates: ORIGINAL_DATASET_COUNT,
						outputName,
						variantScores: generatedReferences.map((entry) => entry.score),
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
					referenceImageCount:
						generatedReferences.length + ORIGINAL_DATASET_COUNT,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
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
