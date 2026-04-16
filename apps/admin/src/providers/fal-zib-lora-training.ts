import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import {
	buildZipFromBuffers,
	downloadImageAsset,
	persistLoraWeightsToS3,
	type S3Config,
	uploadZipToS3,
} from "@/providers/lora-training-assets";

const FAL_QUEUE_BASE = "https://queue.fal.run";
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TRAINING_STEPS = 1000;
const DEFAULT_TRAINING_POLL_MS = 30_000;
const DEFAULT_TRAINING_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_DATASET_POLL_MS = 5000;
const DEFAULT_DATASET_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const REFERENCE_COUNT = 19;
const FLUX_REFERENCE_EDIT_MODEL = "fal-ai/flux-2/edit";
const fileExtensionPattern = /\.[^.]+$/u;

const REFERENCE_VARIANT_SUFFIXES = [
	"same subject, front-facing editorial portrait, soft daylight, neutral backdrop",
	"same subject, three-quarter portrait, warm studio key light, realistic skin detail",
	"same subject, close-up beauty portrait, diffused window light, shallow depth of field",
	"same subject, medium shot portrait, clean white cyc wall, fashion studio lighting",
	"same subject, outdoor portrait, golden hour sun, subtle breeze in hair",
	"same subject, street portrait, overcast daylight, muted urban background",
	"same subject, cinematic portrait, rim light, dark neutral background",
	"same subject, smiling portrait, bright commercial lighting, clean framing",
	"same subject, moody portrait, single overhead spotlight, deep shadow on one side",
	"same subject, high-key portrait, pure white background, soft even lighting",
	"same subject, natural portrait, dappled sunlight through foliage, relaxed pose",
	"same subject, editorial close-up, dramatic side light, catchlight in eyes",
	"same subject, glamour portrait, backlit hair glow, soft focus edges",
	"same subject, casual portrait, coffee shop interior, ambient warm tones",
	"same subject, professional headshot, solid grey background, centered framing",
	"same subject, artistic portrait, blue hour twilight, soft cool tones",
	"same subject, lifestyle portrait, airy minimalist interior, natural window light",
	"same subject, dramatic portrait, chiaroscuro lighting, strong jaw shadow",
	"same subject, soft portrait, overcast flat lighting, pastel toned background",
] as const;

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

function buildReferencePrompt(input: {
	description?: string;
	personName: string;
	referencePrompt?: string;
}) {
	return (
		input.referencePrompt?.trim() ||
		(input.description?.trim().length
			? `portrait photo of ${input.personName}, ${input.description}`
			: `portrait photo of ${input.personName}, preserve the same identity and facial features`)
	);
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
	private readonly personsApiBaseUrl: string;
	private readonly trainingControlToken: string;
	private readonly s3Config?: S3Config;
	private readonly logger: Pick<Console, "info" | "error">;

	constructor(options: {
		apiKey: string;
		personsApiBaseUrl: string;
		trainingControlToken: string;
		s3Config?: S3Config;
		logger?: Pick<Console, "info" | "error">;
	}) {
		this.apiKey = options.apiKey;
		this.personsApiBaseUrl = options.personsApiBaseUrl;
		this.trainingControlToken = options.trainingControlToken;
		this.s3Config = options.s3Config;
		this.logger = options.logger ?? console;
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
			const baseReferencePrompt = buildReferencePrompt({
				description: parsed.description,
				personName: parsed.personName,
				referencePrompt: parsed.referencePrompt,
			});

			this.logger.info("fal-zib-lora.generating-references", {
				personId: parsed.personId,
				count: REFERENCE_COUNT,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						baseReferencePrompt,
						referenceModel: FLUX_REFERENCE_EDIT_MODEL,
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

			const referenceImageUrls: string[] = [];
			for (const suffix of REFERENCE_VARIANT_SUFFIXES.slice(
				0,
				REFERENCE_COUNT
			)) {
				const prompt = `${baseReferencePrompt}, ${suffix}`;
				const url = await generateReferenceImageFal(
					this.apiKey,
					parsed.referencePhotoUrl,
					prompt
				);
				referenceImageUrls.push(url);
				this.logger.info("fal-zib-lora.reference-generated", {
					personId: parsed.personId,
					index: referenceImageUrls.length,
					total: REFERENCE_COUNT,
				});

				await this.sendTrainingEvent({
					personId: parsed.personId,
					event: {
						debugCorrelationId: parsed.debugCorrelationId,
						lastEventAt: new Date().toISOString(),
						phase: "generating-references",
						progressPct: buildGeneratingProgress(referenceImageUrls.length + 1),
						provider: "fal",
						referenceImageCount: referenceImageUrls.length + 1,
						referenceImageTargetCount: REFERENCE_COUNT + 1,
						referenceImageUrls: [
							parsed.referencePhotoUrl,
							...referenceImageUrls,
						],
						status: "generating",
						trainingRunId: parsed.trainingRunId,
						triggerWord,
					},
				});
			}

			this.logger.info("fal-zib-lora.downloading-dataset", {
				personId: parsed.personId,
				imageCount: referenceImageUrls.length + 1,
			});

			const refPhoto = await downloadImageAsset(parsed.referencePhotoUrl);
			const generatedImages = await Promise.all(
				referenceImageUrls.map(async (url, index) => {
					const image = await downloadImageAsset(url);
					return {
						name: `${String(index + 1).padStart(3, "0")}${image.extension}`,
						data: image.data,
					};
				})
			);

			const captionContent = genderHint
				? `a photo of ${triggerWord} ${genderHint}, portrait`
				: `a photo of ${triggerWord}, portrait`;
			const zipFiles: Array<{ name: string; data: Uint8Array }> = [
				{ name: `000${refPhoto.extension}`, data: refPhoto.data },
				{
					name: "000.txt",
					data: new TextEncoder().encode(captionContent),
				},
			];

			for (const img of generatedImages) {
				zipFiles.push(img);
				zipFiles.push({
					name: img.name.replace(fileExtensionPattern, ".txt"),
					data: new TextEncoder().encode(captionContent),
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
					referenceImageCount: referenceImageUrls.length + 1,
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
						defaultCaption: captionContent,
						outputName,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "starting-training",
					progressPct: 70,
					provider: "fal",
					referenceImageCount: referenceImageUrls.length + 1,
					referenceImageTargetCount: REFERENCE_COUNT + 1,
					referenceImageUrls: [parsed.referencePhotoUrl, ...referenceImageUrls],
					status: "training",
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt: new Date().toISOString(),
					trainingSteps: Number(
						process.env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS
					),
					triggerWord,
					uploadMethod: "s3",
				},
			});

			this.logger.info("fal-zib-lora.starting-training", {
				personId: parsed.personId,
				steps: Number(
					process.env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS
				),
			});

			const trainingSteps = Number(
				process.env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS
			);
			const trainingModel = "fal-ai/z-image-trainer";
			const trainingStartedAt = new Date().toISOString();
			const trainingStartedMs = Date.now();
			const trainingSubmit = await falSubmit(this.apiKey, trainingModel, {
				image_data_url: datasetUrl,
				steps: trainingSteps,
				default_caption: captionContent,
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
					referenceImageCount: referenceImageUrls.length + 1,
					referenceImageTargetCount: REFERENCE_COUNT + 1,
					referenceImageUrls: [parsed.referencePhotoUrl, ...referenceImageUrls],
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
