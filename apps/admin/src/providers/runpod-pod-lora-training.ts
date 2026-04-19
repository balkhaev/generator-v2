/**
 * Pod-mode runner для тренировки персон-LoRA через ai-toolkit на RunPod GPU Pods.
 *
 * Архитектура (см. tools/runpod-ai-toolkit/pod-bootstrap.sh + pod_runner.py):
 *   1. Готовим датасет тем же flux-2/edit пайплайном через
 *      `buildReferenceDataset` (общий с fal/serverless runner).
 *   2. Заливаем zip в наш S3.
 *   3. Генерим pre-signed PUT URL для финальных весов
 *      `loras/runpod-pod/<output>.safetensors` (≈6 часов жизни).
 *   4. POST RunPod REST API /v1/pods — поднимаем on-demand GPU pod из готового
 *      pytorch-образа. dockerStartCmd запускает наш bootstrap-скрипт, который
 *      ставит ai-toolkit и гоняет тренировку с параметрами из env.
 *   5. Polling /v1/pods/{id} — ждём, пока pod уйдёт в EXITED. Параллельно
 *      публикуем training events с `provider: "runpod-pod"`.
 *   6. Когда pod вышел — забираем уже залитый артефакт из нашего S3 и
 *      терминируем pod (DELETE).
 *
 * Этот файл — изолированная экспериментальная фича, рядом с
 * RunpodAiToolkitLoraTrainingRunner (serverless вариант). Чтобы выпилить:
 *   - удалить этот файл,
 *   - удалить tools/runpod-ai-toolkit/pod-* скрипты,
 *   - убрать RUNPOD_TRAINING_MODE/RUNPOD_POD_* из packages/env/src/server.ts,
 *   - убрать ветку pod-mode из apps/admin/src/worker.ts.
 *
 * Recovery: при рестарте admin-worker мы можем подобрать запущенный pod
 * по providerJobId (=podId) и продолжить poll loop. Это делает
 * `resumeFromProviderJob` ниже + соответствующий sweep в
 * `recovery/training-recovery.ts`.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { env } from "@generator/env/server";
import type {
	ApprovedDatasetItem,
	EventPublisher,
	PersonDatasetVariantRefillRequest,
	PersonLoraTrainingConfirmation,
} from "@generator/events";
import {
	buildPublicAssetUrl,
	buildZipFromBuffers,
	createPresignedPutUrl,
	createS3Client,
	type S3StorageConfig,
	uploadZipToS3,
} from "@generator/storage";
import { z } from "zod";

import {
	assembleDatasetZipFromItems,
	buildDefaultTriggerWord,
	buildReferenceDataset,
	generateSingleVariant,
	inferGenderHint,
	ORIGINAL_PHOTO_DUPLICATES,
	type PreparedDatasetPhoto,
	prepareDatasetPhotos,
	REFERENCE_VARIANT_COUNT,
	sanitizeSegment,
	TOTAL_DATASET_COUNT,
} from "@/providers/lora-dataset-builder";
import type {
	RunpodPodClient,
	RunpodPodSnapshot,
	RunpodPodStatus,
} from "@/providers/runpod-pod-client";

const DEFAULT_TRAINING_STEPS = 1200;
const DEFAULT_LEARNING_RATE = 0.0001;
const DEFAULT_LORA_RANK = 16;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const PRESIGNED_URL_TTL_SECONDS = 6 * 60 * 60;
const LORA_S3_PREFIX = "loras/runpod-pod";
const LOG_S3_PREFIX = "loras/runpod-pod/logs";

const POLL_PROGRESS_MIN = 80;
const POLL_PROGRESS_MAX = 99;
const TQDM_STEP_PATTERN = /(\d+)\s*\/\s*(\d+)\s*\[/g;

const POD_TRAINING_PROVIDER = "runpod-pod" as const;
const TRAINING_MODEL_LABEL = "ai-toolkit-pod";

export type RunpodAiToolkitBaseModel =
	| "z-image"
	| "flux-dev"
	| "flux-schnell"
	| "flux2-dev"
	| "sdxl"
	| "qwen-image";

export const startRunpodPodTrainingSchema = z.object({
	debugCorrelationId: z.string().trim().min(1).optional(),
	description: z.string().trim().optional(),
	/**
	 * Pipeline mode set by persons-service:
	 *   - `"prep-only"` (default for first-time trainings) — generate the
	 *     dataset photos individually + emit `awaiting-approval`. The
	 *     operator must call `confirmAndTrain` afterwards.
	 *   - `"auto-train"` — legacy single-shot path (datasetPrep + zip +
	 *     train). Used for retrains via `reuseDatasetUrl` and for tests.
	 */
	mode: z.enum(["prep-only", "auto-train"]).optional(),
	outputName: z.string().trim().min(1).optional(),
	personId: z.string().trim().min(1),
	personName: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	referencePhotoUrl: z.url(),
	referencePrompt: z.string().trim().min(1).optional(),
	/**
	 * URL уже готового reference-zip от предыдущей тренировки. Если задан —
	 * runner полностью пропускает фазы `generating-references` /
	 * `uploading-dataset` (никаких fal.ai-вызовов, никакой пересборки zip)
	 * и подаёт этот URL pod'у напрямую через DATASET_URL.
	 */
	reuseDatasetUrl: z.url().optional(),
	trainingRunId: z.string().trim().min(1),
	triggerWord: z.string().trim().min(1).optional(),
});

type StartInput = z.infer<typeof startRunpodPodTrainingSchema>;

export const resumeRunpodPodTrainingSchema = z.object({
	debugCorrelationId: z.string().trim().min(1).optional(),
	loraS3Key: z.string().trim().min(1).optional(),
	outputName: z.string().trim().min(1),
	personId: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	providerJobId: z.string().trim().min(1),
	referenceImageCount: z.number().int().nonnegative(),
	referenceImageTargetCount: z.number().int().positive(),
	referenceImageUrls: z.array(z.string()).default([]),
	trainingRunId: z.string().trim().min(1),
	trainingStartedAt: z.string().trim().min(1),
	trainingSteps: z.number().int().positive(),
	triggerWord: z.string().trim().min(1),
});

type ResumeInput = z.infer<typeof resumeRunpodPodTrainingSchema>;

type TrainingEventStatus =
	| "queued"
	| "generating"
	| "training"
	| "publishing"
	| "ready"
	| "failed"
	| "awaiting-approval";

interface ReferenceImageItemEvent {
	caption: string;
	s3Key: string | null;
	url: string;
	variantId: string;
}

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
	/**
	 * Per-photo dataset descriptors. Persons-service upserts these by
	 * `variantId`, so the same array element may be re-emitted (with a new url
	 * + s3Key) after a refill without creating duplicate generation rows.
	 */
	referenceImageItems?: ReferenceImageItemEvent[];
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

interface RunpodPodLoraTrainingRunnerOptions {
	baseModel?: RunpodAiToolkitBaseModel;
	bootstrapUrl: string;
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	eventPublisher?: EventPublisher | null;
	falApiKeyForDataset: string;
	fetchImpl?: typeof fetch;
	/**
	 * Резолвер активной dataset-editor-модели (см. dataset-builder-settings).
	 * Вызывается перед каждым job-ом, чтобы смена модели в админке
	 * применялась к новым тренировкам без рестарта worker-а.
	 */
	getDatasetEditorModelId?: () => Promise<string>;
	gpuTypeIds: string[];
	hfToken?: string;
	imageName: string;
	logger?: Pick<Console, "info" | "error">;
	networkVolumeId?: string;
	personsApiBaseUrl?: string;
	podClient: RunpodPodClient;
	podRunnerUrl: string;
	pollMs?: number;
	resultCallbackUrl?: string;
	s3Config: S3StorageConfig;
	/**
	 * Опциональный id RunPod-template, передаётся в createPod, чтобы
	 * scheduler предпочёл хосты с уже warm template (быстрый pull).
	 */
	templateId?: string;
	trainingControlToken: string;
	trainingTimeoutMs?: number;
	volumeInGb?: number;
}

export class RunpodPodLoraTrainingRunner {
	private readonly baseModel: RunpodAiToolkitBaseModel;
	private readonly bootstrapUrl: string;
	private readonly cloudType: "SECURE" | "COMMUNITY";
	private readonly containerDiskInGb: number;
	private readonly eventPublisher: EventPublisher | null;
	private readonly falApiKeyForDataset: string;
	private readonly fetchImpl: typeof fetch;
	private readonly getDatasetEditorModelId: () => Promise<string>;
	private readonly gpuTypeIds: string[];
	private readonly hfToken?: string;
	private readonly imageName: string;
	private readonly logger: Pick<Console, "info" | "error">;
	private readonly networkVolumeId?: string;
	private readonly personsApiBaseUrl?: string;
	private readonly podClient: RunpodPodClient;
	private readonly podRunnerUrl: string;
	private readonly pollMs: number;
	private readonly resultCallbackUrl?: string;
	private readonly s3Config: S3StorageConfig;
	private readonly templateId?: string;
	private readonly trainingControlToken: string;
	private readonly trainingTimeoutMs: number;
	private readonly volumeInGb: number;

	constructor(options: RunpodPodLoraTrainingRunnerOptions) {
		this.baseModel = options.baseModel ?? "z-image";
		this.bootstrapUrl = options.bootstrapUrl;
		this.cloudType = options.cloudType ?? "SECURE";
		this.containerDiskInGb = options.containerDiskInGb ?? 60;
		this.eventPublisher = options.eventPublisher ?? null;
		this.falApiKeyForDataset = options.falApiKeyForDataset;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.getDatasetEditorModelId =
			options.getDatasetEditorModelId ??
			(() => Promise.resolve("fal-ai/flux-2/edit"));
		this.gpuTypeIds = options.gpuTypeIds;
		this.hfToken = options.hfToken;
		this.imageName = options.imageName;
		this.logger = options.logger ?? console;
		this.networkVolumeId = options.networkVolumeId;
		this.personsApiBaseUrl = options.personsApiBaseUrl;
		this.podClient = options.podClient;
		this.podRunnerUrl = options.podRunnerUrl;
		this.pollMs = options.pollMs ?? 30_000;
		this.resultCallbackUrl = options.resultCallbackUrl;
		this.s3Config = options.s3Config;
		this.templateId = options.templateId;
		this.trainingControlToken = options.trainingControlToken;
		this.trainingTimeoutMs = options.trainingTimeoutMs ?? 120 * 60 * 1000;
		this.volumeInGb = options.volumeInGb ?? 60;
	}

	/**
	 * Достаёт текущее `metadata.training` персоны через persons-api. Используется
	 * для idempotency-guard: чтобы повторный Kafka-event на тот же
	 * (personId, trainingRunId) не плодил второй RunPod pod, если первый ещё
	 * жив или уже долил артефакт.
	 *
	 * Возвращает `null`, если персона не найдена / persons-api недоступен /
	 * training meta отсутствует — в этом случае вызов пройдёт по обычному пути.
	 */
	private async fetchPersonTrainingMeta(personId: string): Promise<{
		providerJobId: string | null;
		status: string | null;
		trainingRunId: string | null;
	} | null> {
		if (!this.personsApiBaseUrl) {
			return null;
		}
		try {
			const response = await this.fetchImpl(
				`${this.personsApiBaseUrl}/api/internal/persons/${encodeURIComponent(personId)}`,
				{
					headers: {
						authorization: `Bearer ${this.trainingControlToken}`,
					},
				}
			);
			if (response.status === 404 || !response.ok) {
				return null;
			}
			const body = (await response.json()) as {
				person?: { metadata?: Record<string, unknown> };
			};
			const metadata = body.person?.metadata;
			if (!metadata || typeof metadata !== "object") {
				return null;
			}
			const training = (metadata as Record<string, unknown>).training;
			if (
				!training ||
				typeof training !== "object" ||
				Array.isArray(training)
			) {
				return null;
			}
			const t = training as Record<string, unknown>;
			return {
				providerJobId:
					typeof t.providerJobId === "string" ? t.providerJobId : null,
				status: typeof t.status === "string" ? t.status : null,
				trainingRunId:
					typeof t.trainingRunId === "string" ? t.trainingRunId : null,
			};
		} catch (error) {
			this.logger.error("runpod-pod.fetch-person-failed", {
				message: error instanceof Error ? error.message : String(error),
				personId,
			});
			return null;
		}
	}

	/**
	 * HEAD-запрос к S3 через Bun.S3Client. Возвращает `{ exists, size }`,
	 * `exists=false` если объект не найден или произошла любая ошибка stat'а.
	 * Используется для верификации, что pod действительно долил `.safetensors`,
	 * прежде чем мы маркируем training как `ready` (и наоборот — после внешнего
	 * TERMINATED, чтобы не флапать готовый артефакт).
	 */
	private async checkLoraArtifactInS3(s3Key: string): Promise<{
		exists: boolean;
		size: number | null;
	}> {
		try {
			const client = createS3Client(this.s3Config);
			const stat = await client.file(s3Key).stat();
			return { exists: true, size: stat.size ?? null };
		} catch {
			return { exists: false, size: null };
		}
	}

	/**
	 * Возвращает последние `tailBytes` живого pod-лога из S3 (его шипит
	 * `pod-bootstrap.sh` каждые 15с в `LOG_UPLOAD_URL`). Используется для
	 * парсинга tqdm-прогресса в `pollUntilExited` — без этого UI висит на
	 * статичных 80% всё время тренировки. На любой ошибке возвращает null,
	 * чтобы poll loop продолжал работать без логов.
	 */
	private async fetchPodLogTail(
		s3Key: string,
		tailBytes = 16 * 1024
	): Promise<string | null> {
		try {
			const client = createS3Client(this.s3Config);
			const file = client.file(s3Key);
			const stat = await file.stat();
			const size = stat.size ?? 0;
			if (size === 0) {
				return null;
			}
			const start = Math.max(0, size - tailBytes);
			return await file.slice(start).text();
		} catch {
			return null;
		}
	}

	/**
	 * Достаёт последний `step/total` из tqdm-вывода ai-toolkit. Формат:
	 *   "  96%|█████████▌| 1151/1200 [02:32<00:06,  7.45it/s]"
	 * Берём последнее совпадение, т.к. tqdm перезаписывает строку через `\r`
	 * и в S3-файле эти кадры лежат подряд.
	 */
	private parseTqdmProgress(
		logTail: string
	): { step: number; total: number } | null {
		const matches = [...logTail.matchAll(TQDM_STEP_PATTERN)];
		const last = matches.at(-1);
		if (!last) {
			return null;
		}
		const step = Number(last[1]);
		const total = Number(last[2]);
		if (
			!(
				Number.isFinite(step) &&
				Number.isFinite(total) &&
				total > 0 &&
				step >= 0 &&
				step <= total
			)
		) {
			return null;
		}
		return { step, total };
	}

	/**
	 * Возвращает progressPct в диапазоне [POLL_PROGRESS_MIN..POLL_PROGRESS_MAX]
	 * на основе tqdm-прогресса из логов. Если лог недоступен/не содержит
	 * валидный прогресс — отдаёт floor (80%), как и было до парсинга.
	 */
	private async resolvePollProgressPct(input: {
		logS3Key: string;
		trainingSteps: number;
	}): Promise<{ pct: number; step: number | null; total: number | null }> {
		const tail = await this.fetchPodLogTail(input.logS3Key);
		if (!tail) {
			return { pct: POLL_PROGRESS_MIN, step: null, total: null };
		}
		const progress = this.parseTqdmProgress(tail);
		if (!progress) {
			return { pct: POLL_PROGRESS_MIN, step: null, total: null };
		}
		const ratio = progress.step / progress.total;
		const span = POLL_PROGRESS_MAX - POLL_PROGRESS_MIN;
		const pct = Math.min(
			POLL_PROGRESS_MAX,
			Math.max(POLL_PROGRESS_MIN, POLL_PROGRESS_MIN + Math.round(span * ratio))
		);
		return { pct, step: progress.step, total: progress.total };
	}

	private async sendTrainingEvent(input: {
		event: TrainingEventPayload;
		personId: string;
	}): Promise<void> {
		const eventWithProvider: TrainingEventPayload = {
			...input.event,
			provider: input.event.provider ?? POD_TRAINING_PROVIDER,
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

	/**
	 * Idempotency guard: при повторной доставке Kafka-event'а на тот же
	 * (personId, trainingRunId) проверяем persons-api: если уже записан
	 * providerJobId со статусом generating/training и сам RunPod-pod ещё
	 * жив (≠TERMINATED) — это duplicate. Возвращает `true`, если вызывающий
	 * должен молча выйти и оставить существующий poll-loop / recovery sweep.
	 */
	private async shouldIgnoreDuplicateKafkaStart(
		parsed: StartInput
	): Promise<boolean> {
		const existingTraining = await this.fetchPersonTrainingMeta(
			parsed.personId
		);
		if (
			!existingTraining ||
			existingTraining.trainingRunId !== parsed.trainingRunId ||
			!existingTraining.providerJobId ||
			!existingTraining.status ||
			(existingTraining.status !== "training" &&
				existingTraining.status !== "generating")
		) {
			return false;
		}
		try {
			const existingPod = await this.podClient.getPod(
				existingTraining.providerJobId
			);
			const podStatus = existingPod.desiredStatus ?? "RUNNING";
			if (podStatus === "TERMINATED") {
				return false;
			}
			this.logger.info("runpod-pod.duplicate-event-ignored", {
				existingPodId: existingTraining.providerJobId,
				personId: parsed.personId,
				podStatus,
				trainingRunId: parsed.trainingRunId,
			});
			return true;
		} catch (error) {
			this.logger.info("runpod-pod.idempotency-pod-not-found", {
				existingPodId: existingTraining.providerJobId,
				message: error instanceof Error ? error.message : String(error),
				personId: parsed.personId,
			});
			return false;
		}
	}

	/**
	 * Готовит reference-датасет двумя путями:
	 *
	 *   - **reuse**: если в `parsed.reuseDatasetUrl` есть готовый zip от
	 *     предыдущей тренировки — пропускаем 19 fal.ai/flux-2/edit вызовов
	 *     и просто отдаём этот URL pod'у. Captions уже встроены в zip
	 *     как `.txt` рядом с каждым кадром (см. `lora-dataset-builder.ts`),
	 *     `default_caption` в ai-toolkit config используется только для
	 *     слотов без `.txt`, поэтому в reuse-режиме ставим минимальный
	 *     fallback (`triggerWord`).
	 *
	 *   - **build**: классический путь — генерим 19 вариаций через fal,
	 *     дублируем оригинал 6 раз, собираем zip, заливаем в S3. Используется
	 *     при первой тренировке персоны и при явном `regenerateDataset=true`.
	 */
	private async prepareReferenceDataset(input: {
		genderHint: string | null;
		outputName: string;
		parsed: StartInput;
		triggerWord: string;
	}): Promise<{
		datasetUrl: string;
		datasetZipSizeBytes: number | null;
		defaultCaption: string;
		referenceImageCount: number;
		referenceImageUrls: string[];
		reused: boolean;
	}> {
		const { parsed, triggerWord, genderHint, outputName } = input;

		if (parsed.reuseDatasetUrl) {
			this.logger.info("runpod-pod.dataset-reused", {
				datasetUrl: parsed.reuseDatasetUrl,
				personId: parsed.personId,
				trainingRunId: parsed.trainingRunId,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					datasetUrl: parsed.reuseDatasetUrl,
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "starting-training",
					progressPct: 65,
					referenceImageCount: TOTAL_DATASET_COUNT,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					referenceImageUrls: [parsed.referencePhotoUrl],
					status: "training",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
					uploadMethod: "reused",
				},
			});
			return {
				datasetUrl: parsed.reuseDatasetUrl,
				datasetZipSizeBytes: null,
				defaultCaption: triggerWord,
				referenceImageCount: TOTAL_DATASET_COUNT,
				referenceImageUrls: [parsed.referencePhotoUrl],
				reused: true,
			};
		}

		await this.sendTrainingEvent({
			personId: parsed.personId,
			event: {
				debugCorrelationId: parsed.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				phase: "generating-references",
				progressPct: buildGeneratingProgress(ORIGINAL_PHOTO_DUPLICATES),
				referenceImageCount: ORIGINAL_PHOTO_DUPLICATES,
				referenceImageTargetCount: TOTAL_DATASET_COUNT,
				status: "generating",
				trainingRunId: parsed.trainingRunId,
				triggerWord,
			},
		});

		const editorModelId = await this.getDatasetEditorModelId();
		const dataset = await buildReferenceDataset({
			apiKey: this.falApiKeyForDataset,
			editorModelId,
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

		return {
			datasetUrl,
			datasetZipSizeBytes: zipData.length,
			defaultCaption: dataset.defaultCaption,
			referenceImageCount:
				dataset.generatedReferences.length + ORIGINAL_PHOTO_DUPLICATES,
			referenceImageUrls: [
				parsed.referencePhotoUrl,
				...dataset.generatedReferences.map((entry) => entry.url),
			],
			reused: false,
		};
	}

	/**
	 * Builds canonical S3 keys + public URLs for the trainer artifacts.
	 * Centralised so prep, confirm, recovery and resume all derive identical
	 * paths from `(personSlug, outputName, trainingRunId)`.
	 */
	private buildArtifactKeys(input: {
		outputName: string;
		trainingRunId: string;
	}): {
		logPublicUrl: string;
		logS3Key: string;
		loraPublicUrl: string;
		loraS3Key: string;
	} {
		const safeOutput = sanitizeSegment(input.outputName);
		const runSuffix = input.trainingRunId.slice(0, 8);
		const loraS3Key = `${LORA_S3_PREFIX}/${safeOutput}-${runSuffix}.safetensors`;
		const logS3Key = `${LOG_S3_PREFIX}/${safeOutput}-${runSuffix}.log`;
		return {
			logPublicUrl: buildPublicAssetUrl(this.s3Config, logS3Key),
			logS3Key,
			loraPublicUrl: buildPublicAssetUrl(this.s3Config, loraS3Key),
			loraS3Key,
		};
	}

	private resolveOutputName(parsed: {
		outputName?: string;
		personSlug: string;
	}): string {
		return (
			parsed.outputName ??
			`${sanitizeSegment(parsed.personSlug)}-runpod-pod-lora-${Date.now()}`
		);
	}

	/**
	 * Generates dataset photos one-by-one (uploading each to S3) and emits a
	 * per-photo training event with `referenceImageItems` so persons-service
	 * can incrementally surface the gallery. Finishes by emitting an
	 * `awaiting-approval` event — the runner does NOT touch RunPod here. The
	 * actual training is triggered later via {@link confirmAndTrain} once the
	 * operator clicks "Train LoRA".
	 */
	private async executeDatasetPrep(parsed: StartInput): Promise<void> {
		const triggerWord =
			parsed.triggerWord ?? buildDefaultTriggerWord(parsed.personSlug);
		const genderHint = inferGenderHint(parsed.description);
		const outputName = this.resolveOutputName(parsed);
		const startedAt = new Date().toISOString();

		try {
			this.logger.info("runpod-pod.prep.starting", {
				outputName,
				personId: parsed.personId,
				trainingRunId: parsed.trainingRunId,
			});

			const accumulated: PreparedDatasetPhoto[] = [];
			const editorModelId = await this.getDatasetEditorModelId();

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						baseModel: this.baseModel,
						originalPhotoDuplicates: ORIGINAL_PHOTO_DUPLICATES,
						outputName,
						referenceVariantCount: REFERENCE_VARIANT_COUNT,
						sourceReferencePhotoUrl: parsed.referencePhotoUrl,
						trainingModel: TRAINING_MODEL_LABEL,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: startedAt,
					phase: "generating-references",
					progressPct: buildGeneratingProgress(0),
					referenceImageCount: 0,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			await prepareDatasetPhotos({
				apiKey: this.falApiKeyForDataset,
				editorModelId,
				genderHint,
				onPhotoReady: async (photo) => {
					accumulated.push(photo);
					await this.sendTrainingEvent({
						personId: parsed.personId,
						event: {
							debugCorrelationId: parsed.debugCorrelationId,
							lastEventAt: new Date().toISOString(),
							phase: "generating-references",
							progressPct: buildGeneratingProgress(accumulated.length),
							referenceImageCount: accumulated.length,
							referenceImageItems: [photo],
							referenceImageTargetCount: TOTAL_DATASET_COUNT,
							referenceImageUrls: accumulated.map((entry) => entry.url),
							status: "generating",
							trainingRunId: parsed.trainingRunId,
							triggerWord,
						},
					});
				},
				personId: parsed.personId,
				referencePhotoUrl: parsed.referencePhotoUrl,
				referencePrompt: parsed.referencePrompt,
				s3Config: this.s3Config,
				trainingRunId: parsed.trainingRunId,
				triggerWord,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						baseModel: this.baseModel,
						outputName,
						readyForApproval: true,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "awaiting-approval",
					progressPct: 60,
					referenceImageCount: accumulated.length,
					referenceImageItems: accumulated,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					referenceImageUrls: accumulated.map((entry) => entry.url),
					status: "awaiting-approval",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			this.logger.info("runpod-pod.prep.awaiting-approval", {
				outputName,
				personId: parsed.personId,
				photoCount: accumulated.length,
				trainingRunId: parsed.trainingRunId,
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error
					? error.message
					: "RunPod pod-mode dataset prep failed";
			this.logger.error("runpod-pod.prep.failed", {
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

	/**
	 * Generates a single replacement variant for a rejected dataset slot,
	 * uploads it to S3 and emits a training event with one
	 * `referenceImageItems[]` entry. Persons-service upserts that slot in the
	 * gallery and clears the per-variant "regenerating" indicator.
	 *
	 * Note: refilling an `original-NN` slot is a no-op because originals are
	 * just captioned copies of the reference photo and therefore not deletable
	 * in the UI in the first place.
	 */
	private async executeRefillVariant(
		input: PersonDatasetVariantRefillRequest
	): Promise<void> {
		try {
			const editorModelId = await this.getDatasetEditorModelId();
			const photo = await generateSingleVariant({
				apiKey: this.falApiKeyForDataset,
				editorModelId,
				genderHint: inferGenderHint(input.description),
				personId: input.personId,
				referencePhotoUrl: input.referencePhotoUrl,
				referencePrompt: input.referencePrompt,
				s3Config: this.s3Config,
				trainingRunId: input.trainingRunId,
				triggerWord: input.triggerWord,
				variantId: input.variantId,
			});
			await this.sendTrainingEvent({
				personId: input.personId,
				event: {
					debug: {
						refillRequestNonce: input.requestNonce,
						refillVariantId: input.variantId,
					},
					debugCorrelationId: input.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "refilling-references",
					referenceImageItems: [photo],
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: "awaiting-approval",
					trainingRunId: input.trainingRunId,
					triggerWord: input.triggerWord,
				},
			});
			this.logger.info("runpod-pod.refill.completed", {
				personId: input.personId,
				trainingRunId: input.trainingRunId,
				variantId: input.variantId,
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error ? error.message : "Variant refill failed";
			this.logger.error("runpod-pod.refill.failed", {
				error: errorSummary,
				personId: input.personId,
				trainingRunId: input.trainingRunId,
				variantId: input.variantId,
			});
			await this.sendTrainingEvent({
				personId: input.personId,
				event: {
					debug: {
						refillRequestNonce: input.requestNonce,
						refillVariantId: input.variantId,
					},
					debugCorrelationId: input.debugCorrelationId,
					errorSummary,
					lastEventAt: new Date().toISOString(),
					phase: "refilling-references",
					status: "awaiting-approval",
					trainingRunId: input.trainingRunId,
					triggerWord: input.triggerWord,
				},
			});
			throw error;
		}
	}

	/**
	 * Consumes the operator-approved dataset list, packs it into a zip, uploads
	 * it to S3 and runs the same RunPod pipeline as the legacy `run()` path
	 * (presigned URLs + pod create + poll until EXITED + verify artifact).
	 */
	private async executeConfirmAndTrain(
		parsed: StartInput,
		approvedItems: readonly ApprovedDatasetItem[]
	): Promise<void> {
		const triggerWord =
			parsed.triggerWord ?? buildDefaultTriggerWord(parsed.personSlug);
		const trainingSteps =
			env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS;
		const outputName = this.resolveOutputName(parsed);
		const { loraS3Key, loraPublicUrl, logS3Key, logPublicUrl } =
			this.buildArtifactKeys({
				outputName,
				trainingRunId: parsed.trainingRunId,
			});

		let podId: string | null = null;
		try {
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						approvedItemCount: approvedItems.length,
						baseModel: this.baseModel,
						outputName,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "uploading-dataset",
					progressPct: 62,
					referenceImageCount: approvedItems.length,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: "training",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
					uploadMethod: "s3",
				},
			});

			const dataset = await assembleDatasetZipFromItems({
				defaultCaption: triggerWord,
				items: approvedItems.map((item) => ({
					caption: item.caption,
					url: item.url,
					variantId: item.variantId,
				})),
			});
			const zipData = buildZipFromBuffers(dataset.zipFiles);
			const datasetUrl = await uploadZipToS3(
				zipData,
				`${outputName}-dataset.zip`,
				this.s3Config
			);

			await this.runRunpodPodTrainingPipeline({
				datasetUrl,
				datasetZipSizeBytes: zipData.length,
				defaultCaption: dataset.defaultCaption,
				logPublicUrl,
				logS3Key,
				loraPublicUrl,
				loraS3Key,
				outputName,
				parsed,
				podIdRef: (id) => {
					podId = id;
				},
				referenceImageCount: approvedItems.length,
				referenceImageUrls: dataset.referenceImageUrls,
				trainingSteps,
				triggerWord,
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error
					? error.message
					: "RunPod pod-mode LoRA training failed";
			this.logger.error("runpod-pod.failed", {
				error: errorSummary,
				personId: parsed.personId,
				podId,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debugCorrelationId: parsed.debugCorrelationId,
					errorSummary,
					failedAt: new Date().toISOString(),
					lastEventAt: new Date().toISOString(),
					phase: "failed",
					providerJobId: podId,
					status: "failed",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});
			throw error;
		} finally {
			if (podId) {
				await this.podClient.deletePod(podId);
			}
		}
	}

	/**
	 * Shared trainer-submission pipeline used by both the legacy `auto-train`
	 * path (datasetPrep + train inline) and the new `confirmAndTrain` path
	 * (zip already assembled from operator-approved photos):
	 *   1. Mint presigned PUT URLs for the LoRA artifact and live log.
	 *   2. Emit `starting-training` event.
	 *   3. Create RunPod pod via REST API and emit `polling-training`.
	 *   4. Poll pod until EXITED (or until the artifact lands).
	 *   5. Verify `.safetensors` is in S3 — pods sometimes EXIT before
	 *      flushing the artifact (OOM/torch crash) and we'd otherwise mark
	 *      the run `ready` with a 404 loraUrl.
	 *   6. Emit `ready` event.
	 *
	 * The pipeline does NOT delete the pod on failure — that's the caller's
	 * responsibility (via `podIdRef` + finally block) so failures and the
	 * happy-path share one cleanup site.
	 */
	private async runRunpodPodTrainingPipeline(input: {
		datasetUrl: string;
		datasetZipSizeBytes: number | null;
		defaultCaption: string;
		logPublicUrl: string;
		logS3Key: string;
		loraPublicUrl: string;
		loraS3Key: string;
		outputName: string;
		parsed: Pick<
			StartInput,
			| "debugCorrelationId"
			| "personId"
			| "personSlug"
			| "referencePhotoUrl"
			| "trainingRunId"
		>;
		podIdRef: (id: string) => void;
		referenceImageCount: number;
		referenceImageUrls: string[];
		reused?: boolean;
		trainingSteps: number;
		triggerWord: string;
	}): Promise<void> {
		const {
			datasetUrl,
			datasetZipSizeBytes,
			defaultCaption,
			logPublicUrl,
			logS3Key,
			loraPublicUrl,
			loraS3Key,
			outputName,
			parsed,
			podIdRef,
			referenceImageCount,
			referenceImageUrls,
			reused = false,
			trainingSteps,
			triggerWord,
		} = input;

		const loraUploadUrl = await createPresignedPutUrl(
			{
				contentType: "application/octet-stream",
				expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
				key: loraS3Key,
			},
			this.s3Config
		);
		const logUploadUrl = await createPresignedPutUrl(
			{
				contentType: "text/plain; charset=utf-8",
				expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
				key: logS3Key,
			},
			this.s3Config
		);

		await this.sendTrainingEvent({
			personId: parsed.personId,
			event: {
				datasetUrl,
				datasetZipSizeBytes,
				debug: {
					baseModel: this.baseModel,
					datasetReused: reused,
					defaultCaption,
					loraS3Key,
					originalPhotoDuplicates: ORIGINAL_PHOTO_DUPLICATES,
					outputName,
				},
				debugCorrelationId: parsed.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				phase: "starting-training",
				progressPct: 70,
				referenceImageCount,
				referenceImageTargetCount: TOTAL_DATASET_COUNT,
				referenceImageUrls,
				status: "training",
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt: new Date().toISOString(),
				trainingSteps,
				triggerWord,
				uploadMethod: reused ? "reused" : "s3",
			},
		});

		const trainingStartedAt = new Date().toISOString();
		const trainingStartedMs = Date.now();

		const podEnv: Record<string, string> = {
			BASE_MODEL: this.baseModel,
			DATASET_URL: datasetUrl,
			DEFAULT_CAPTION: defaultCaption,
			LEARNING_RATE: String(DEFAULT_LEARNING_RATE),
			LOG_UPLOAD_URL: logUploadUrl,
			LORA_RANK: String(DEFAULT_LORA_RANK),
			LORA_UPLOAD_CONTENT_TYPE: "application/octet-stream",
			LORA_UPLOAD_URL: loraUploadUrl,
			OUTPUT_NAME: outputName,
			POD_RUNNER_URL: this.podRunnerUrl,
			TRAINING_STEPS: String(trainingSteps),
			TRIGGER_WORD: triggerWord,
		};
		if (this.hfToken) {
			podEnv.HF_TOKEN = this.hfToken;
		}
		if (this.resultCallbackUrl) {
			podEnv.RESULT_CALLBACK_URL = this.resultCallbackUrl;
			podEnv.RESULT_CALLBACK_TOKEN = this.trainingControlToken;
		}

		const pod = await this.podClient.createPod({
			cloudType: this.cloudType,
			containerDiskInGb: this.containerDiskInGb,
			dockerStartCmd: [
				"bash",
				"-lc",
				`curl -sSfL "${this.bootstrapUrl}" | bash`,
			],
			env: podEnv,
			gpuCount: 1,
			gpuTypeIds: this.gpuTypeIds,
			imageName: this.imageName,
			name: `ai-toolkit-${sanitizeSegment(parsed.personSlug).slice(0, 32)}-${parsed.trainingRunId.slice(0, 6)}`,
			networkVolumeId: this.networkVolumeId,
			ports: ["22/tcp"],
			supportPublicIp: false,
			templateId: this.templateId,
			volumeInGb: this.volumeInGb,
			volumeMountPath: "/workspace",
		});

		const podId = pod.id;
		podIdRef(podId);
		this.logger.info("runpod-pod.started", {
			gpuTypeIds: this.gpuTypeIds,
			personId: parsed.personId,
			podId,
		});

		await this.sendTrainingEvent({
			personId: parsed.personId,
			event: {
				debug: {
					podId,
					podLogUrl: logPublicUrl,
					runpodPodConsoleUrl: `https://runpod.io/console/pods/${podId}`,
				},
				debugCorrelationId: parsed.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				phase: "polling-training",
				progressPct: 76,
				providerJobId: podId,
				providerRequestId: podId,
				providerStatus: pod.desiredStatus ?? "RUNNING",
				status: "training",
				trainingElapsedMs: 0,
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt,
				trainingSteps,
				triggerWord,
			},
		});

		await this.pollUntilExited({
			datasetUrl,
			debugCorrelationId: parsed.debugCorrelationId,
			logS3Key,
			loraS3Key,
			outputName,
			personId: parsed.personId,
			podId,
			referenceImageCount,
			referenceImageTargetCount: TOTAL_DATASET_COUNT,
			referenceImageUrls,
			trainingRunId: parsed.trainingRunId,
			trainingStartedAt,
			trainingStartedMs,
			trainingSteps,
			triggerWord,
		});

		const artifactCheck = await this.checkLoraArtifactInS3(loraS3Key);
		if (!artifactCheck.exists) {
			throw new Error(
				`RunPod pod ${podId} exited but lora artifact missing in S3 (${loraS3Key}). Check pod logs.`
			);
		}
		this.logger.info("runpod-pod.artifact-verified", {
			loraS3Key,
			personId: parsed.personId,
			podId,
			sizeBytes: artifactCheck.size,
		});

		await this.sendTrainingEvent({
			personId: parsed.personId,
			event: {
				completedAt: new Date().toISOString(),
				datasetUrl,
				debug: {
					baseModel: this.baseModel,
					datasetReused: reused,
					loraS3Key,
					podId,
				},
				debugCorrelationId: parsed.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				loraUrl: loraPublicUrl,
				phase: "ready",
				progressPct: 100,
				providerJobId: podId,
				providerRequestId: podId,
				providerStatus: "EXITED",
				referenceImageCount,
				referenceImageTargetCount: TOTAL_DATASET_COUNT,
				referenceImageUrls,
				status: "ready",
				trainingElapsedMs: Date.now() - trainingStartedMs,
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt,
				trainingSteps,
				triggerWord,
				uploadMethod: reused ? "reused" : "s3",
			},
		});
	}

	private async executeRunpodPodTraining(parsed: StartInput): Promise<void> {
		const triggerWord =
			parsed.triggerWord ?? buildDefaultTriggerWord(parsed.personSlug);
		const genderHint = inferGenderHint(parsed.description);
		const startedAt = new Date().toISOString();
		const trainingSteps =
			env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS;
		const outputName = this.resolveOutputName(parsed);
		const { loraS3Key, loraPublicUrl, logS3Key, logPublicUrl } =
			this.buildArtifactKeys({
				outputName,
				trainingRunId: parsed.trainingRunId,
			});

		let podId: string | null = null;

		try {
			this.logger.info("runpod-pod.starting", {
				baseModel: this.baseModel,
				personId: parsed.personId,
				reuseDataset: Boolean(parsed.reuseDatasetUrl),
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						baseModel: this.baseModel,
						datasetReused: Boolean(parsed.reuseDatasetUrl),
						gpuTypeIds: this.gpuTypeIds,
						imageName: this.imageName,
						originalPhotoDuplicates: ORIGINAL_PHOTO_DUPLICATES,
						referenceVariantCount: REFERENCE_VARIANT_COUNT,
						sourceReferencePhotoUrl: parsed.referencePhotoUrl,
						trainingModel: TRAINING_MODEL_LABEL,
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: startedAt,
					phase: parsed.reuseDatasetUrl
						? "starting-training"
						: "generating-references",
					progressPct: parsed.reuseDatasetUrl
						? 60
						: buildGeneratingProgress(ORIGINAL_PHOTO_DUPLICATES),
					referenceImageCount: parsed.reuseDatasetUrl
						? TOTAL_DATASET_COUNT
						: ORIGINAL_PHOTO_DUPLICATES,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					status: parsed.reuseDatasetUrl ? "training" : "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			const datasetPrep = await this.prepareReferenceDataset({
				genderHint,
				outputName,
				parsed,
				triggerWord,
			});

			await this.runRunpodPodTrainingPipeline({
				datasetUrl: datasetPrep.datasetUrl,
				datasetZipSizeBytes: datasetPrep.datasetZipSizeBytes,
				defaultCaption: datasetPrep.defaultCaption,
				logPublicUrl,
				logS3Key,
				loraPublicUrl,
				loraS3Key,
				outputName,
				parsed,
				podIdRef: (id) => {
					podId = id;
				},
				referenceImageCount: datasetPrep.referenceImageCount,
				referenceImageUrls: datasetPrep.referenceImageUrls,
				reused: datasetPrep.reused,
				trainingSteps,
				triggerWord,
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error
					? error.message
					: "RunPod pod-mode LoRA training failed";
			this.logger.error("runpod-pod.failed", {
				error: errorSummary,
				personId: parsed.personId,
				podId,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debugCorrelationId: parsed.debugCorrelationId,
					errorSummary,
					failedAt: new Date().toISOString(),
					lastEventAt: new Date().toISOString(),
					phase: "failed",
					providerJobId: podId,
					status: "failed",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});
			throw error;
		} finally {
			if (podId) {
				await this.podClient.deletePod(podId);
			}
		}
	}

	/**
	 * Top-level entry from worker.ts. Routing matrix:
	 *   - `mode === "auto-train"` OR `reuseDatasetUrl` set → legacy single-shot
	 *     path (datasetPrep + zip + train), no awaiting-approval gate. Used
	 *     for retrains and tests.
	 *   - default (`mode === "prep-only"` or undefined) → only generate dataset
	 *     photos and emit `awaiting-approval`. Operator must explicitly call
	 *     {@link confirmAndTrain} to start the actual LoRA training.
	 */
	async run(input: StartInput): Promise<void> {
		const parsed = startRunpodPodTrainingSchema.parse(input);
		if (await this.shouldIgnoreDuplicateKafkaStart(parsed)) {
			return;
		}
		const autoTrain =
			parsed.mode === "auto-train" || Boolean(parsed.reuseDatasetUrl);
		if (autoTrain) {
			await this.executeRunpodPodTraining(parsed);
			return;
		}
		await this.executeDatasetPrep(parsed);
	}

	/**
	 * Public entry for the operator-driven approval flow. Generates the full
	 * 25-photo dataset, uploads each photo to S3 individually, and finishes by
	 * publishing an `awaiting-approval` event so the persons UI can render the
	 * gallery + a "Train LoRA" CTA.
	 */
	async prepareDataset(input: StartInput): Promise<void> {
		const parsed = startRunpodPodTrainingSchema.parse(input);
		if (await this.shouldIgnoreDuplicateKafkaStart(parsed)) {
			return;
		}
		await this.executeDatasetPrep(parsed);
	}

	/**
	 * Generates one replacement variant for a rejected dataset slot. Called by
	 * the worker in response to a `personDatasetVariantRefillRequested` event
	 * after the operator deletes a photo in the UI.
	 */
	async refillVariant(input: PersonDatasetVariantRefillRequest): Promise<void> {
		await this.executeRefillVariant(input);
	}

	/**
	 * Public entry for `personLoraTrainingConfirmed`. Takes the operator's
	 * approved dataset list, packs it into a zip, uploads it, and submits to
	 * RunPod. Idempotency-safe: if a previous confirm is already running for
	 * the same `(personId, trainingRunId)` we skip via the same guard as
	 * `run()`.
	 */
	async confirmAndTrain(input: PersonLoraTrainingConfirmation): Promise<void> {
		const { approvedItems, ...request } = input;
		const parsed = startRunpodPodTrainingSchema.parse(request);
		if (await this.shouldIgnoreDuplicateKafkaStart(parsed)) {
			return;
		}
		await this.executeConfirmAndTrain(parsed, approvedItems);
	}

	/**
	 * Подхватывает уже запущенный RunPod pod (создан предыдущей инкарнацией
	 * worker'а) и продолжает poll loop до EXITED. Используется boot-time
	 * recovery sweep в `recovery/training-recovery.ts`.
	 *
	 * Контракт совпадает с `run`:
	 *   - на успех — публикует `ready` event с уже известным loraUrl;
	 *   - на падение — `failed` event;
	 *   - в любом случае удаляет pod через REST API.
	 */
	async resumeFromProviderJob(input: ResumeInput): Promise<void> {
		const parsed = resumeRunpodPodTrainingSchema.parse(input);
		const trainingStartedMs = Date.parse(parsed.trainingStartedAt);
		if (!Number.isFinite(trainingStartedMs)) {
			throw new Error(
				`Invalid trainingStartedAt for resume: ${parsed.trainingStartedAt}`
			);
		}

		const loraS3Key =
			parsed.loraS3Key ??
			`${LORA_S3_PREFIX}/${sanitizeSegment(parsed.outputName)}-${parsed.trainingRunId.slice(0, 8)}.safetensors`;
		const loraPublicUrl = buildPublicAssetUrl(this.s3Config, loraS3Key);

		this.logger.info("runpod-pod.resume", {
			personId: parsed.personId,
			podId: parsed.providerJobId,
			trainingRunId: parsed.trainingRunId,
		});

		try {
			// Fast-path: если артефакт уже в S3 (типично для recovery после
			// падения admin-worker'а), пропускаем polling и финализируем сразу.
			// Это спасает от ложного timeout, когда pod давно отработал, а
			// исходный trainingStartedAt уже за границей trainingTimeoutMs.
			const preCheck = await this.checkLoraArtifactInS3(loraS3Key);
			if (preCheck.exists) {
				this.logger.info("runpod-pod.resume-fast-path", {
					loraS3Key,
					personId: parsed.personId,
					podId: parsed.providerJobId,
					sizeBytes: preCheck.size,
				});
				try {
					await this.podClient.stopPod(parsed.providerJobId);
				} catch (stopError) {
					this.logger.error("runpod-pod.resume-stop-failed", {
						message: stopError instanceof Error ? stopError.message : "unknown",
						podId: parsed.providerJobId,
					});
				}
				await this.sendTrainingEvent({
					personId: parsed.personId,
					event: {
						completedAt: new Date().toISOString(),
						debug: {
							baseModel: this.baseModel,
							loraS3Key,
							podId: parsed.providerJobId,
							recovered: true,
							recoveredAt: new Date().toISOString(),
							recoveryFastPath: true,
						},
						debugCorrelationId: parsed.debugCorrelationId,
						lastEventAt: new Date().toISOString(),
						loraUrl: loraPublicUrl,
						phase: "ready",
						progressPct: 100,
						providerJobId: parsed.providerJobId,
						providerRequestId: parsed.providerJobId,
						providerStatus: "EXITED",
						referenceImageCount: parsed.referenceImageCount,
						referenceImageTargetCount: parsed.referenceImageTargetCount,
						referenceImageUrls: parsed.referenceImageUrls,
						status: "ready",
						trainingElapsedMs: Date.now() - trainingStartedMs,
						trainingRunId: parsed.trainingRunId,
						trainingStartedAt: parsed.trainingStartedAt,
						trainingSteps: parsed.trainingSteps,
						triggerWord: parsed.triggerWord,
						uploadMethod: "s3",
					},
				});
				return;
			}

			const logS3Key = `${LOG_S3_PREFIX}/${sanitizeSegment(parsed.outputName)}-${parsed.trainingRunId.slice(0, 8)}.log`;

			await this.pollUntilExited({
				datasetUrl: "",
				debugCorrelationId: parsed.debugCorrelationId,
				logS3Key,
				loraS3Key,
				outputName: parsed.outputName,
				personId: parsed.personId,
				podId: parsed.providerJobId,
				referenceImageCount: parsed.referenceImageCount,
				referenceImageTargetCount: parsed.referenceImageTargetCount,
				referenceImageUrls: parsed.referenceImageUrls,
				trainingRunId: parsed.trainingRunId,
				trainingStartedAt: parsed.trainingStartedAt,
				trainingStartedMs,
				trainingSteps: parsed.trainingSteps,
				triggerWord: parsed.triggerWord,
			});

			const artifactCheck = await this.checkLoraArtifactInS3(loraS3Key);
			if (!artifactCheck.exists) {
				throw new Error(
					`RunPod pod ${parsed.providerJobId} exited but lora artifact missing in S3 (${loraS3Key}). Check pod logs.`
				);
			}
			this.logger.info("runpod-pod.resume-artifact-verified", {
				loraS3Key,
				personId: parsed.personId,
				podId: parsed.providerJobId,
				sizeBytes: artifactCheck.size,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					completedAt: new Date().toISOString(),
					debug: {
						baseModel: this.baseModel,
						loraS3Key,
						podId: parsed.providerJobId,
						recovered: true,
						recoveredAt: new Date().toISOString(),
					},
					debugCorrelationId: parsed.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					loraUrl: loraPublicUrl,
					phase: "ready",
					progressPct: 100,
					providerJobId: parsed.providerJobId,
					providerRequestId: parsed.providerJobId,
					providerStatus: "EXITED",
					referenceImageCount: parsed.referenceImageCount,
					referenceImageTargetCount: parsed.referenceImageTargetCount,
					referenceImageUrls: parsed.referenceImageUrls,
					status: "ready",
					trainingElapsedMs: Date.now() - trainingStartedMs,
					trainingRunId: parsed.trainingRunId,
					trainingStartedAt: parsed.trainingStartedAt,
					trainingSteps: parsed.trainingSteps,
					triggerWord: parsed.triggerWord,
					uploadMethod: "s3",
				},
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error
					? error.message
					: "RunPod pod-mode resume failed";
			this.logger.error("runpod-pod.resume-failed", {
				error: errorSummary,
				personId: parsed.personId,
				podId: parsed.providerJobId,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debugCorrelationId: parsed.debugCorrelationId,
					errorSummary,
					failedAt: new Date().toISOString(),
					lastEventAt: new Date().toISOString(),
					phase: "failed",
					providerJobId: parsed.providerJobId,
					status: "failed",
					trainingRunId: parsed.trainingRunId,
					triggerWord: parsed.triggerWord,
				},
			});
			throw error;
		} finally {
			try {
				await this.podClient.deletePod(parsed.providerJobId);
			} catch (deleteError) {
				this.logger.error("runpod-pod.resume-delete-failed", {
					message:
						deleteError instanceof Error ? deleteError.message : "unknown",
					podId: parsed.providerJobId,
				});
			}
		}
	}

	/**
	 * Pod снесли извне (вручную / через MCP / quota). Прежде чем падать,
	 * проверим S3 — pod_runner мог успеть долить .safetensors до того, как
	 * его снесли. Тогда трактуем как ready.
	 */
	private async handleTerminatedPod(input: {
		loraS3Key: string;
		personId: string;
		pod: RunpodPodSnapshot;
		podId: string;
	}): Promise<RunpodPodSnapshot> {
		const artifactCheck = await this.checkLoraArtifactInS3(input.loraS3Key);
		if (artifactCheck.exists) {
			this.logger.info("runpod-pod.terminated-but-artifact-ready", {
				loraS3Key: input.loraS3Key,
				personId: input.personId,
				podId: input.podId,
				sizeBytes: artifactCheck.size,
			});
			return input.pod;
		}
		throw new Error(
			"RunPod pod was terminated externally before training finished"
		);
	}

	/**
	 * Authoritative-источник готовности — наличие .safetensors в S3.
	 * pod-bootstrap.sh после успешного pod_runner.py делает `exec sleep
	 * infinity` (RunPod иначе перезапускает контейнер по бесконечному
	 * кругу), поэтому desiredStatus останется RUNNING вечно. Стопаем
	 * pod руками и выходим как успех.
	 */
	private async stopPodIfArtifactReady(input: {
		loraS3Key: string;
		personId: string;
		pod: RunpodPodSnapshot;
		podId: string;
	}): Promise<RunpodPodSnapshot | null> {
		const artifactCheck = await this.checkLoraArtifactInS3(input.loraS3Key);
		if (!artifactCheck.exists) {
			return null;
		}
		this.logger.info("runpod-pod.artifact-ready-stopping-pod", {
			loraS3Key: input.loraS3Key,
			personId: input.personId,
			podId: input.podId,
			sizeBytes: artifactCheck.size,
		});
		try {
			await this.podClient.stopPod(input.podId);
		} catch (stopError) {
			this.logger.error("runpod-pod.stop-after-artifact-failed", {
				message: stopError instanceof Error ? stopError.message : "unknown",
				podId: input.podId,
			});
		}
		return input.pod;
	}

	private async emitPollProgressEvent(input: {
		debugCorrelationId?: string;
		logS3Key: string;
		personId: string;
		podId: string;
		providerStatus: RunpodPodStatus;
		referenceImageCount: number;
		referenceImageTargetCount: number;
		trainingRunId: string;
		trainingStartedAt: string;
		trainingStartedMs: number;
		trainingSteps: number;
		triggerWord: string;
	}): Promise<void> {
		const progress = await this.resolvePollProgressPct({
			logS3Key: input.logS3Key,
			trainingSteps: input.trainingSteps,
		});
		const tqdmDebug =
			progress.step !== null && progress.total !== null
				? { tqdmStep: progress.step, tqdmTotal: progress.total }
				: null;

		await this.sendTrainingEvent({
			personId: input.personId,
			event: {
				...(tqdmDebug ? { debug: tqdmDebug } : {}),
				debugCorrelationId: input.debugCorrelationId,
				lastEventAt: new Date().toISOString(),
				phase: "polling-training",
				progressPct: progress.pct,
				providerJobId: input.podId,
				providerRequestId: input.podId,
				providerStatus: input.providerStatus,
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
	}

	private async pollUntilExited(input: {
		datasetUrl: string;
		debugCorrelationId?: string;
		logS3Key: string;
		loraS3Key: string;
		outputName: string;
		personId: string;
		podId: string;
		referenceImageCount: number;
		referenceImageTargetCount: number;
		referenceImageUrls: string[];
		trainingRunId: string;
		trainingStartedAt: string;
		trainingStartedMs: number;
		trainingSteps: number;
		triggerWord: string;
	}): Promise<RunpodPodSnapshot> {
		const deadline = input.trainingStartedMs + this.trainingTimeoutMs;

		while (Date.now() < deadline) {
			const pod = await this.podClient.getPod(input.podId);
			const status: RunpodPodStatus = pod.desiredStatus ?? "RUNNING";

			if (status === "EXITED") {
				return pod;
			}
			if (status === "TERMINATED") {
				return await this.handleTerminatedPod({
					loraS3Key: input.loraS3Key,
					personId: input.personId,
					pod,
					podId: input.podId,
				});
			}

			const stoppedFromArtifact = await this.stopPodIfArtifactReady({
				loraS3Key: input.loraS3Key,
				personId: input.personId,
				pod,
				podId: input.podId,
			});
			if (stoppedFromArtifact) {
				return stoppedFromArtifact;
			}

			await this.emitPollProgressEvent({
				debugCorrelationId: input.debugCorrelationId,
				logS3Key: input.logS3Key,
				personId: input.personId,
				podId: input.podId,
				providerStatus: status,
				referenceImageCount: input.referenceImageCount,
				referenceImageTargetCount: input.referenceImageTargetCount,
				trainingRunId: input.trainingRunId,
				trainingStartedAt: input.trainingStartedAt,
				trainingStartedMs: input.trainingStartedMs,
				trainingSteps: input.trainingSteps,
				triggerWord: input.triggerWord,
			});

			await sleep(this.pollMs);
		}

		await this.podClient.stopPod(input.podId);
		throw new Error(
			`RunPod pod ${input.podId} timed out after ${this.trainingTimeoutMs}ms`
		);
	}
}
