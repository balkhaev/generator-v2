/**
 * Экспериментальный runner для тренировки персон-LoRA через ai-toolkit на
 * RunPod serverless. Параллельная альтернатива {@link FalZibLoraTrainingRunner}.
 *
 * Архитектура:
 *   1. Готовим датасет тем же flux-2/edit пайплайном через
 *      `buildReferenceDataset` (общий с fal-runner).
 *   2. Заливаем zip в наш S3 (как и в fal flow).
 *   3. POST /run в RunPod → handler внутри pod-а скачивает датасет, гоняет
 *      ai-toolkit, заливает результирующий .safetensors в наш же S3 и возвращает
 *      `output.lora_url`.
 *   4. Polling /status — публикуем training events с `provider: "runpod"`.
 *   5. Кэшируем веса повторно через `persistLoraWeightsToS3` — на случай, если
 *      handler не положил в наш bucket (или положил с временным URL).
 *
 * Этот файл — изолированная экспериментальная фича. Чтобы выпилить интеграцию,
 * достаточно удалить:
 *   - этот файл,
 *   - tools/runpod-ai-toolkit/,
 *   - блок `if (provider === "runpod")` в apps/admin/src/worker.ts,
 *   - RUNPOD_* поля в packages/env/src/server.ts.
 *
 * Recovery (resume after crash) для RunPod пока НЕ реализован — если воркер
 * упадёт в момент polling-а, job в RunPod дожмёт сам, но мы не успеем поймать
 * результат и пометить персону как ready. Перезапуск тренировки руками = OK
 * для эксперимента.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { env } from "@generator/env/server";
import type { EventPublisher } from "@generator/events";
import {
	buildZipFromBuffers,
	persistLoraWeightsToS3,
	type S3StorageConfig,
	uploadZipToS3,
} from "@generator/storage";
import { z } from "zod";

import {
	buildDefaultTriggerWord,
	buildReferenceDataset,
	inferGenderHint,
	ORIGINAL_PHOTO_DUPLICATES,
	REFERENCE_VARIANT_COUNT,
	sanitizeSegment,
	TOTAL_DATASET_COUNT,
} from "@/providers/lora-dataset-builder";

const DEFAULT_TRAINING_STEPS = 1200;
const DEFAULT_LEARNING_RATE = 0.0001;
const DEFAULT_LORA_RANK = 16;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const TRAILING_SLASH = /\/$/;

const RUNPOD_TRAINING_PROVIDER = "runpod" as const;
const TRAINING_MODEL_LABEL = "ai-toolkit";

const runpodStatusMap = {
	IN_QUEUE: "queued",
	IN_PROGRESS: "running",
	COMPLETED: "succeeded",
	FAILED: "failed",
	CANCELLED: "failed",
	TIMED_OUT: "failed",
} as const;

type RunpodStatus = keyof typeof runpodStatusMap;

const RUNPOD_TERMINAL_STATUSES = new Set<RunpodStatus>([
	"COMPLETED",
	"FAILED",
	"CANCELLED",
	"TIMED_OUT",
]);

const HANDLER_OUTPUT_SCHEMA = z.object({
	lora_url: z.url(),
	lora_size_bytes: z.number().int().nonnegative().optional(),
	training_seconds: z.number().nonnegative().optional(),
	debug: z.record(z.string(), z.unknown()).optional(),
});

const RUNPOD_RESPONSE_SCHEMA = z.object({
	id: z.string().min(1),
	status: z.string().optional(),
	output: z.unknown().optional(),
	error: z.unknown().optional(),
	executionTime: z.number().optional(),
	delayTime: z.number().optional(),
});

export type RunpodAiToolkitBaseModel =
	| "z-image"
	| "flux-dev"
	| "flux-schnell"
	| "flux2-dev"
	| "sdxl"
	| "qwen-image";

export const startRunpodAiToolkitTrainingSchema = z.object({
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

type StartInput = z.infer<typeof startRunpodAiToolkitTrainingSchema>;

type TrainingEventStatus =
	| "queued"
	| "generating"
	| "training"
	| "publishing"
	| "ready"
	| "failed";

interface TrainingEventPayload {
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

interface RunpodSubmission {
	jobId: string;
	rawStatus: string;
}

interface RunpodStatusResult {
	error: string | null;
	output: unknown;
	rawStatus: string;
	status: (typeof runpodStatusMap)[RunpodStatus] | "unknown";
}

function normalizeRunpodStatus(
	rawStatus: string
): RunpodStatusResult["status"] {
	const known = runpodStatusMap[rawStatus as RunpodStatus];
	return known ?? "unknown";
}

function extractErrorMessage(payload: unknown, fallback: string): string {
	if (typeof payload === "string" && payload.length > 0) {
		return payload;
	}
	if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		for (const key of ["error", "message", "detail"]) {
			const value = record[key];
			if (typeof value === "string" && value.length > 0) {
				return value;
			}
		}
		try {
			return JSON.stringify(payload);
		} catch {
			// fall through
		}
	}
	return fallback;
}

export class RunpodAiToolkitLoraTrainingRunner {
	private readonly apiKey: string;
	private readonly apiBaseUrl: string;
	private readonly baseModel: RunpodAiToolkitBaseModel;
	private readonly endpointId: string;
	private readonly eventPublisher: EventPublisher | null;
	private readonly fetchImpl: typeof fetch;
	private readonly logger: Pick<Console, "info" | "error">;
	private readonly personsApiBaseUrl?: string;
	private readonly pollMs: number;
	private readonly s3Config?: S3StorageConfig;
	private readonly trainingControlToken: string;
	private readonly trainingTimeoutMs: number;
	private readonly falApiKeyForDataset: string;

	constructor(options: {
		apiBaseUrl?: string;
		apiKey: string;
		baseModel?: RunpodAiToolkitBaseModel;
		endpointId: string;
		eventPublisher?: EventPublisher | null;
		falApiKeyForDataset: string;
		fetchImpl?: typeof fetch;
		logger?: Pick<Console, "info" | "error">;
		personsApiBaseUrl?: string;
		pollMs?: number;
		s3Config?: S3StorageConfig;
		trainingControlToken: string;
		trainingTimeoutMs?: number;
	}) {
		this.apiKey = options.apiKey;
		this.apiBaseUrl = (
			options.apiBaseUrl ?? "https://api.runpod.ai/v2"
		).replace(TRAILING_SLASH, "");
		this.baseModel = options.baseModel ?? "z-image";
		this.endpointId = options.endpointId;
		this.eventPublisher = options.eventPublisher ?? null;
		this.falApiKeyForDataset = options.falApiKeyForDataset;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.logger = options.logger ?? console;
		this.personsApiBaseUrl = options.personsApiBaseUrl;
		this.pollMs = options.pollMs ?? 30_000;
		this.s3Config = options.s3Config;
		this.trainingControlToken = options.trainingControlToken;
		this.trainingTimeoutMs = options.trainingTimeoutMs ?? 120 * 60 * 1000;
	}

	private get authHeaders(): Record<string, string> {
		return {
			authorization: `Bearer ${this.apiKey}`,
			"content-type": "application/json",
		};
	}

	private async sendTrainingEvent(input: {
		event: TrainingEventPayload;
		personId: string;
	}): Promise<void> {
		const eventWithProvider: TrainingEventPayload = {
			...input.event,
			provider: input.event.provider ?? RUNPOD_TRAINING_PROVIDER,
		};

		if (this.eventPublisher) {
			await this.eventPublisher.publishPersonLoraTrainingUpdated({
				context: {
					personId: input.personId,
					trainingRunId: eventWithProvider.trainingRunId ?? null,
				},
				event: eventWithProvider,
			});
			return;
		}

		if (!this.personsApiBaseUrl) {
			throw new Error(
				"PERSONS_API_URL or KAFKA_BROKERS is required to publish training events"
			);
		}

		await retry(async () => {
			const response = await this.fetchImpl(
				`${this.personsApiBaseUrl}/api/internal/lora-trainings`,
				{
					body: JSON.stringify({
						context: { personId: input.personId },
						event: eventWithProvider,
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

	private async submitToRunpod(
		input: Record<string, unknown>
	): Promise<RunpodSubmission> {
		const url = `${this.apiBaseUrl}/${this.endpointId}/run`;
		const response = await this.fetchImpl(url, {
			body: JSON.stringify({ input }),
			headers: this.authHeaders,
			method: "POST",
		});
		await ensureSuccessfulResponse(response, "RunPod /run");
		const body = await response.json();
		const parsed = RUNPOD_RESPONSE_SCHEMA.parse(body);
		return {
			jobId: parsed.id,
			rawStatus: parsed.status ?? "IN_QUEUE",
		};
	}

	private async getRunpodStatus(jobId: string): Promise<RunpodStatusResult> {
		const url = `${this.apiBaseUrl}/${this.endpointId}/status/${jobId}`;
		const response = await this.fetchImpl(url, {
			headers: this.authHeaders,
		});
		await ensureSuccessfulResponse(response, "RunPod /status");
		const body = await response.json();
		const parsed = RUNPOD_RESPONSE_SCHEMA.parse(body);
		const rawStatus = parsed.status ?? "IN_QUEUE";
		return {
			error:
				parsed.error === undefined || parsed.error === null
					? null
					: extractErrorMessage(parsed.error, "RunPod job failed"),
			output: parsed.output ?? null,
			rawStatus,
			status: normalizeRunpodStatus(rawStatus),
		};
	}

	private async cancelRunpodJob(jobId: string): Promise<void> {
		try {
			await this.fetchImpl(
				`${this.apiBaseUrl}/${this.endpointId}/cancel/${jobId}`,
				{
					headers: this.authHeaders,
					method: "POST",
				}
			);
		} catch {
			// best-effort cancellation
		}
	}

	async run(input: StartInput): Promise<void> {
		const parsed = startRunpodAiToolkitTrainingSchema.parse(input);
		const triggerWord =
			parsed.triggerWord ?? buildDefaultTriggerWord(parsed.personSlug);
		const genderHint = inferGenderHint(parsed.description);
		const startedAt = new Date().toISOString();
		const trainingSteps =
			env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS;
		const outputName =
			parsed.outputName ??
			`${sanitizeSegment(parsed.personSlug)}-runpod-lora-${Date.now()}`;

		try {
			this.logger.info("runpod-ai-toolkit.starting", {
				baseModel: this.baseModel,
				personId: parsed.personId,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						baseModel: this.baseModel,
						originalPhotoDuplicates: ORIGINAL_PHOTO_DUPLICATES,
						referenceVariantCount: REFERENCE_VARIANT_COUNT,
						sourceReferencePhotoUrl: parsed.referencePhotoUrl,
						trainingModel: TRAINING_MODEL_LABEL,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: startedAt,
					phase: "generating-references",
					progressPct: buildGeneratingProgress(ORIGINAL_PHOTO_DUPLICATES),
					referenceImageCount: ORIGINAL_PHOTO_DUPLICATES,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			const dataset = await buildReferenceDataset({
				apiKey: this.falApiKeyForDataset,
				genderHint,
				onVariantGenerated: async ({ generated }) => {
					await this.sendTrainingEvent({
						personId: parsed.personId,
						event: {
							debugCorrelationId: parsed.debugCorrelationId,
							lastEventAt: new Date().toISOString(),
							phase: "generating-references",
							progressPct: buildGeneratingProgress(
								generated.length + ORIGINAL_PHOTO_DUPLICATES
							),
							referenceImageCount: generated.length + ORIGINAL_PHOTO_DUPLICATES,
							referenceImageTargetCount: TOTAL_DATASET_COUNT,
							referenceImageUrls: [
								parsed.referencePhotoUrl,
								...generated.map((entry) => entry.url),
							],
							status: "generating",
							trainingRunId: parsed.trainingRunId,
							triggerWord,
						},
					});
				},
				referencePhotoUrl: parsed.referencePhotoUrl,
				referencePrompt: parsed.referencePrompt,
				triggerWord,
			});

			const zipData = buildZipFromBuffers(dataset.zipFiles);
			if (!this.s3Config) {
				throw new Error("S3 config is required to persist LoRA dataset");
			}

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					datasetZipSizeBytes: zipData.length,
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "uploading-dataset",
					progressPct: 62,
					referenceImageCount:
						dataset.generatedReferences.length + ORIGINAL_PHOTO_DUPLICATES,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
					uploadMethod: "s3",
				},
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
						baseModel: this.baseModel,
						defaultCaption: dataset.defaultCaption,
						originalPhotoDuplicates: ORIGINAL_PHOTO_DUPLICATES,
						outputName,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "starting-training",
					progressPct: 70,
					referenceImageCount:
						dataset.generatedReferences.length + ORIGINAL_PHOTO_DUPLICATES,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					referenceImageUrls: [
						parsed.referencePhotoUrl,
						...dataset.generatedReferences.map((entry) => entry.url),
					],
					status: "training",
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt: new Date().toISOString(),
					trainingSteps,
					triggerWord,
					uploadMethod: "s3",
				},
			});

			const trainingStartedAt = new Date().toISOString();
			const trainingStartedMs = Date.now();

			const submission = await this.submitToRunpod({
				base_model: this.baseModel,
				dataset_url: datasetUrl,
				default_caption: dataset.defaultCaption,
				learning_rate: DEFAULT_LEARNING_RATE,
				lora_rank: DEFAULT_LORA_RANK,
				output_name: outputName,
				training_steps: trainingSteps,
				trigger_word: triggerWord,
			});

			this.logger.info("runpod-ai-toolkit.training-started", {
				jobId: submission.jobId,
				personId: parsed.personId,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						runpodEndpointId: this.endpointId,
						runpodStatusUrl: `${this.apiBaseUrl}/${this.endpointId}/status/${submission.jobId}`,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "polling-training",
					progressPct: 76,
					providerJobId: submission.jobId,
					providerRequestId: submission.jobId,
					providerStatus: submission.rawStatus,
					status: "training",
					trainingElapsedMs: 0,
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt,
					trainingSteps,
					triggerWord,
				},
			});

			const handlerOutput = await this.pollUntilDone({
				datasetUrl,
				debugCorrelationId: parsed.debugCorrelationId,
				outputName,
				personId: parsed.personId,
				providerJobId: submission.jobId,
				referenceImageCount:
					dataset.generatedReferences.length + ORIGINAL_PHOTO_DUPLICATES,
				referenceImageTargetCount: TOTAL_DATASET_COUNT,
				referenceImageUrls: [
					parsed.referencePhotoUrl,
					...dataset.generatedReferences.map((entry) => entry.url),
				],
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt,
				trainingStartedMs,
				trainingSteps,
				triggerWord,
			});

			await this.publishReadyLora({
				datasetUrl,
				debugCorrelationId: parsed.debugCorrelationId,
				handlerOutput,
				outputName,
				personId: parsed.personId,
				providerJobId: submission.jobId,
				referenceImageCount:
					dataset.generatedReferences.length + ORIGINAL_PHOTO_DUPLICATES,
				referenceImageTargetCount: TOTAL_DATASET_COUNT,
				referenceImageUrls: [
					parsed.referencePhotoUrl,
					...dataset.generatedReferences.map((entry) => entry.url),
				],
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt,
				trainingStartedMs,
				trainingSteps,
				triggerWord,
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error
					? error.message
					: "RunPod ai-toolkit LoRA training failed";
			this.logger.error("runpod-ai-toolkit.failed", {
				error: errorSummary,
				personId: parsed.personId,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debugCorrelationId: parsed.debugCorrelationId,
					errorSummary,
					failedAt: new Date().toISOString(),
					lastEventAt: new Date().toISOString(),
					phase: "failed",
					status: "failed",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});
			throw error;
		}
	}

	private async pollUntilDone(input: {
		datasetUrl: string;
		debugCorrelationId?: string;
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
	}): Promise<z.infer<typeof HANDLER_OUTPUT_SCHEMA>> {
		const deadline = input.trainingStartedMs + this.trainingTimeoutMs;

		while (Date.now() < deadline) {
			const status = await this.getRunpodStatus(input.providerJobId);

			if (status.error) {
				throw new Error(`RunPod job failed: ${status.error}`);
			}

			if (RUNPOD_TERMINAL_STATUSES.has(status.rawStatus as RunpodStatus)) {
				if (status.status !== "succeeded") {
					throw new Error(
						`RunPod job ended with non-success status: ${status.rawStatus}`
					);
				}
				const parsedOutput = HANDLER_OUTPUT_SCHEMA.safeParse(status.output);
				if (!parsedOutput.success) {
					throw new Error(
						`RunPod job completed but output schema is invalid: ${parsedOutput.error.message}`
					);
				}
				return parsedOutput.data;
			}

			await this.sendTrainingEvent({
				personId: input.personId,
				event: {
					debugCorrelationId: input.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "polling-training",
					progressPct: 76,
					providerJobId: input.providerJobId,
					providerRequestId: input.providerJobId,
					providerStatus: status.rawStatus,
					referenceImageCount: input.referenceImageCount,
					referenceImageTargetCount: input.referenceImageTargetCount,
					status: "training",
					trainingElapsedMs: Date.now() - input.trainingStartedMs,
					trainingRunId: input.trainingRunId,
					trainingStartedAt: input.trainingStartedAt,
					trainingSteps: input.trainingSteps,
					triggerWord: input.triggerWord,
				},
			});

			await sleep(this.pollMs);
		}

		await this.cancelRunpodJob(input.providerJobId);
		throw new Error(
			`RunPod ai-toolkit job timed out after ${this.trainingTimeoutMs}ms`
		);
	}

	private async publishReadyLora(input: {
		datasetUrl: string;
		debugCorrelationId?: string;
		handlerOutput: z.infer<typeof HANDLER_OUTPUT_SCHEMA>;
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
		if (!this.s3Config) {
			throw new Error("S3 config is required to persist LoRA weights");
		}

		await this.sendTrainingEvent({
			personId: input.personId,
			event: {
				debug: { providerLoraUrl: input.handlerOutput.lora_url },
				debugCorrelationId: input.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				phase: "publishing-lora",
				progressPct: 92,
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
				sourceUrl: input.handlerOutput.lora_url,
			},
			this.s3Config
		);

		this.logger.info("runpod-ai-toolkit.lora-persisted", {
			personId: input.personId,
			sizeBytes: persistedLora.sizeBytes,
			url: persistedLora.url,
		});

		await this.sendTrainingEvent({
			personId: input.personId,
			event: {
				completedAt: new Date().toISOString(),
				datasetUrl: input.datasetUrl,
				debug: {
					baseModel: this.baseModel,
					handlerDebug: input.handlerOutput.debug,
					handlerLoraSizeBytes: input.handlerOutput.lora_size_bytes,
					handlerTrainingSeconds: input.handlerOutput.training_seconds,
					loraStorageKey: persistedLora.key,
					loraStorageSizeBytes: persistedLora.sizeBytes,
					persistedLoraUrl: persistedLora.url,
					providerLoraUrl: input.handlerOutput.lora_url,
				},
				debugCorrelationId: input.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				loraUrl: persistedLora.url,
				phase: "ready",
				progressPct: 100,
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
