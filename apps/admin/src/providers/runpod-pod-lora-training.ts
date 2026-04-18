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
import type { EventPublisher } from "@generator/events";
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
	buildDefaultTriggerWord,
	buildReferenceDataset,
	inferGenderHint,
	ORIGINAL_PHOTO_DUPLICATES,
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
	outputName: z.string().trim().min(1).optional(),
	personId: z.string().trim().min(1),
	personName: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	referencePhotoUrl: z.url(),
	referencePrompt: z.string().trim().min(1).optional(),
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

interface RunpodPodLoraTrainingRunnerOptions {
	baseModel?: RunpodAiToolkitBaseModel;
	bootstrapUrl: string;
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	eventPublisher?: EventPublisher | null;
	falApiKeyForDataset: string;
	fetchImpl?: typeof fetch;
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

	private async executeRunpodPodTraining(parsed: StartInput): Promise<void> {
		const triggerWord =
			parsed.triggerWord ?? buildDefaultTriggerWord(parsed.personSlug);
		const genderHint = inferGenderHint(parsed.description);
		const startedAt = new Date().toISOString();
		const trainingSteps =
			env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS;
		const outputName =
			parsed.outputName ??
			`${sanitizeSegment(parsed.personSlug)}-runpod-pod-lora-${Date.now()}`;
		const loraS3Key = `${LORA_S3_PREFIX}/${sanitizeSegment(outputName)}-${parsed.trainingRunId.slice(0, 8)}.safetensors`;
		const loraPublicUrl = buildPublicAssetUrl(this.s3Config, loraS3Key);
		const logS3Key = `${LOG_S3_PREFIX}/${sanitizeSegment(outputName)}-${parsed.trainingRunId.slice(0, 8)}.log`;
		const logPublicUrl = buildPublicAssetUrl(this.s3Config, logS3Key);

		let podId: string | null = null;

		try {
			this.logger.info("runpod-pod.starting", {
				baseModel: this.baseModel,
				personId: parsed.personId,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					debug: {
						baseModel: this.baseModel,
						gpuTypeIds: this.gpuTypeIds,
						imageName: this.imageName,
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
					datasetZipSizeBytes: zipData.length,
					debug: {
						baseModel: this.baseModel,
						defaultCaption: dataset.defaultCaption,
						loraS3Key,
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

			const podEnv: Record<string, string> = {
				BASE_MODEL: this.baseModel,
				DATASET_URL: datasetUrl,
				DEFAULT_CAPTION: dataset.defaultCaption,
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

			podId = pod.id;
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
				loraS3Key,
				outputName,
				personId: parsed.personId,
				podId,
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

			// Verify .safetensors actually landed in S3 — pod иногда уходит в EXITED
			// раньше, чем долил артефакт (OOM, торч-краш и т.п.). Без этой проверки
			// мы маркировали бы тренировку как `ready` с loraUrl, по которому
			// файла нет.
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
					referenceImageCount:
						dataset.generatedReferences.length + ORIGINAL_PHOTO_DUPLICATES,
					referenceImageTargetCount: TOTAL_DATASET_COUNT,
					referenceImageUrls: [
						parsed.referencePhotoUrl,
						...dataset.generatedReferences.map((entry) => entry.url),
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

	async run(input: StartInput): Promise<void> {
		const parsed = startRunpodPodTrainingSchema.parse(input);
		if (await this.shouldIgnoreDuplicateKafkaStart(parsed)) {
			return;
		}
		await this.executeRunpodPodTraining(parsed);
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
			await this.pollUntilExited({
				datasetUrl: "",
				debugCorrelationId: parsed.debugCorrelationId,
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

	private async pollUntilExited(input: {
		datasetUrl: string;
		debugCorrelationId?: string;
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
				// Pod снесли извне (вручную / через MCP / quota). Прежде чем падать,
				// проверим S3 — pod_runner мог успеть долить .safetensors до того, как
				// его снесли (типичный случай: pod успешно завершил тренировку, ушёл
				// в idle перед exit, кто-то ткнул "delete"). Тогда трактуем как ready.
				const artifactCheck = await this.checkLoraArtifactInS3(input.loraS3Key);
				if (artifactCheck.exists) {
					this.logger.info("runpod-pod.terminated-but-artifact-ready", {
						loraS3Key: input.loraS3Key,
						personId: input.personId,
						podId: input.podId,
						sizeBytes: artifactCheck.size,
					});
					return pod;
				}
				throw new Error(
					"RunPod pod was terminated externally before training finished"
				);
			}

			await this.sendTrainingEvent({
				personId: input.personId,
				event: {
					debugCorrelationId: input.debugCorrelationId,
					lastEventAt: new Date().toISOString(),
					phase: "polling-training",
					progressPct: 80,
					providerJobId: input.podId,
					providerRequestId: input.podId,
					providerStatus: status,
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

		await this.podClient.stopPod(input.podId);
		throw new Error(
			`RunPod pod ${input.podId} timed out after ${this.trainingTimeoutMs}ms`
		);
	}
}
