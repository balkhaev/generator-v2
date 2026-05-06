import {
	buildPublicAssetUrl,
	createPresignedPutUrl,
	type S3ObjectStat,
	type S3StorageConfig,
	statS3Object,
} from "@generator/storage";

import type { PodSnapshot, RunpodPodsApi } from "../api/pods";
import type { PodWorkflow } from "../workflow/definition";
import type { Engine, EngineJob, EngineSubmission } from "./engine";

const POD_JOB_SEPARATOR = ":";
const PRESIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
const ARTIFACT_KEY_PREFIX = "generator-artifacts/runpod-pod";
const LOG_CONTENT_TYPE = "text/plain; charset=utf-8";
const SAFE_PREFIX_PATTERN = /[^a-z0-9-]+/gu;
const SAFE_PREFIX_BORDERS_PATTERN = /^-+|-+$/gu;
const POD_NAME_MAX_PREFIX_LENGTH = 48;
const REQUEST_ID_SHORT_LENGTH = 8;

type PodCreatePutUrl = (
	input: { contentType?: string; expiresInSeconds: number; key: string },
	config: S3StorageConfig
) => Promise<string>;

interface PodEngineDeps {
	api: RunpodPodsApi;
	createPutUrl?: PodCreatePutUrl;
	logger?: Pick<Console, "info" | "warn">;
	now?: () => Date;
	randomRequestId?: () => string;
	s3: S3StorageConfig;
	statObject?: typeof statS3Object;
}

interface PodEngineOptions<TInput, TOutput> extends PodEngineDeps {
	workflow: PodWorkflow<TInput, TOutput>;
}

interface ParsedPodJobId {
	podId: string;
	requestId: string;
}

export function formatPodJobId(input: ParsedPodJobId): string {
	return `${input.podId}${POD_JOB_SEPARATOR}${input.requestId}`;
}

export function parsePodJobId(jobId: string): ParsedPodJobId {
	const separatorIndex = jobId.indexOf(POD_JOB_SEPARATOR);
	if (separatorIndex <= 0 || separatorIndex === jobId.length - 1) {
		throw new Error("RunPod pod job id must be formatted as podId:requestId");
	}
	return {
		podId: jobId.slice(0, separatorIndex),
		requestId: jobId.slice(separatorIndex + 1),
	};
}

/**
 * Движок для disposable pod'ов RunPod. Ответственность:
 *
 * - выдать pod'у presigned PUT URL'ы под артефакт и лог,
 * - сформировать env через `workflow.buildEnv`,
 * - запустить pod с bootstrap-командой,
 * - в `getStatus` сначала проверить S3 (success path с авто-cleanup),
 * - на EXITED/TERMINATED без артефакта — пометить failed и удалить pod,
 * - на cancel — best-effort удалить pod.
 *
 * Никаких background-таймеров: один цикл polling = один вызов getStatus,
 * управляется снаружи (worker).
 */
export function createPodEngine<TInput, TOutput>(
	options: PodEngineOptions<TInput, TOutput>
): Engine<TInput, TOutput> {
	const {
		api,
		createPutUrl = createPresignedPutUrl,
		logger,
		randomRequestId = () => crypto.randomUUID(),
		s3,
		statObject = statS3Object,
		workflow,
	} = options;

	const cleanupPod = async (podId: string, reason: string) => {
		try {
			await api.delete(podId);
			logger?.info?.("runpod-pod.cleanup", { podId, reason });
		} catch (error) {
			logger?.warn?.("runpod-pod.cleanup-failed", {
				message: error instanceof Error ? error.message : "unknown",
				podId,
				reason,
			});
		}
	};

	const checkOutputObject = async (
		key: string
	): Promise<S3ObjectStat | null> => {
		try {
			const stat = await statObject(key, s3);
			return stat.sizeBytes > 0 ? stat : null;
		} catch {
			return null;
		}
	};

	return {
		async cancel(jobId) {
			const { podId } = parsePodJobId(jobId);
			await cleanupPod(podId, "cancelled");
		},

		async getStatus(jobId) {
			const { podId, requestId } = parsePodJobId(jobId);
			const outputKey = buildOutputKey(requestId, workflow);
			const logKey = buildLogKey(requestId);
			const outputPublicUrl = buildPublicAssetUrl(s3, outputKey);
			const logPublicUrl = buildPublicAssetUrl(s3, logKey);

			const outputStat = await checkOutputObject(outputKey);
			if (outputStat) {
				await cleanupPod(podId, "artifact-ready");
				const output = workflow.parseOutput({
					logPublicUrl,
					outputPublicUrl,
					outputStat,
					podId,
					requestId,
					runpodPodConsoleUrl: buildRunpodPodConsoleUrl(podId),
				});
				return {
					errorSummary: null,
					jobId,
					output,
					progressPct: 100,
					queuePosition: null,
					status: "succeeded",
				};
			}

			let pod: PodSnapshot;
			try {
				pod = await api.get(podId);
			} catch (error) {
				return {
					errorSummary:
						error instanceof Error
							? error.message
							: `RunPod pod ${podId} disappeared before uploading output`,
					jobId,
					output: null,
					progressPct: null,
					queuePosition: null,
					status: "failed",
				};
			}

			const desiredStatus = pod.desiredStatus ?? "RUNNING";
			if (desiredStatus === "EXITED" || desiredStatus === "TERMINATED") {
				await cleanupPod(podId, "terminated-without-artifact");
				return {
					errorSummary: `RunPod pod ${podId} finished without uploading output. Check pod log: ${logPublicUrl}`,
					jobId,
					output: null,
					progressPct: null,
					queuePosition: null,
					status: "failed",
				};
			}

			return {
				errorSummary: null,
				jobId,
				output: null,
				progressPct: null,
				queuePosition: null,
				status: "running",
			};
		},

		async submit(input): Promise<EngineSubmission> {
			const parsed = workflow.inputSchema.parse(input);
			const requestId = randomRequestId();
			const outputKey = buildOutputKey(requestId, workflow);
			const logKey = buildLogKey(requestId);

			const [outputUploadUrl, logUploadUrl] = await Promise.all([
				createPutUrl(
					{
						contentType: workflow.artifactContentType,
						expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
						key: outputKey,
					},
					s3
				),
				createPutUrl(
					{
						contentType: LOG_CONTENT_TYPE,
						expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
						key: logKey,
					},
					s3
				),
			]);

			const env = workflow.buildEnv(parsed, {
				logPublicUrl: buildPublicAssetUrl(s3, logKey),
				logUploadUrl,
				outputContentType: workflow.artifactContentType,
				outputPublicUrl: buildPublicAssetUrl(s3, outputKey),
				outputUploadUrl,
				requestId,
				s3,
				timeoutMs: workflow.pod.timeoutMs,
			});

			const pod = await api.create({
				cloudType: workflow.pod.cloudType,
				containerDiskInGb: workflow.pod.containerDiskInGb,
				dockerStartCmd: [
					"bash",
					"-lc",
					`curl -sSfL "${workflow.pod.bootstrapUrl}" | bash`,
				],
				env,
				gpuCount: workflow.pod.gpuCount ?? 1,
				gpuTypeIds: workflow.pod.gpuTypeIds,
				imageName: workflow.pod.imageName,
				name: buildPodName(workflow.pod.namePrefix ?? workflow.id, requestId),
				networkVolumeId: workflow.pod.networkVolumeId,
				ports: ["22/tcp"],
				supportPublicIp: false,
				templateId: workflow.pod.templateId,
				volumeInGb: workflow.pod.volumeInGb,
				volumeMountPath: "/workspace",
			});

			logger?.info?.("runpod-pod.started", {
				gpuTypeIds: workflow.pod.gpuTypeIds,
				podId: pod.id,
				requestId,
				workflowId: workflow.id,
			});

			return {
				jobId: formatPodJobId({ podId: pod.id, requestId }),
				queuePosition: null,
				rawProviderJobReference: pod.id,
				status: "queued",
			};
		},
	} satisfies Engine<TInput, TOutput> & {
		getStatus(jobId: string): Promise<EngineJob & { output: TOutput | null }>;
	};
}

function buildOutputKey(
	requestId: string,
	workflow: PodWorkflow<unknown, unknown>
): string {
	const extension = inferExtension(workflow.artifactContentType);
	return `${ARTIFACT_KEY_PREFIX}/${requestId}/output${extension}`;
}

function buildLogKey(requestId: string): string {
	return `${ARTIFACT_KEY_PREFIX}/${requestId}/pod.log`;
}

function inferExtension(contentType: string): string {
	const lower = contentType.toLowerCase();
	if (lower.startsWith("video/mp4")) {
		return ".mp4";
	}
	if (lower.startsWith("video/webm")) {
		return ".webm";
	}
	if (lower.startsWith("image/png")) {
		return ".png";
	}
	if (lower.startsWith("image/jpeg")) {
		return ".jpg";
	}
	if (lower.startsWith("image/webp")) {
		return ".webp";
	}
	return ".bin";
}

function buildRunpodPodConsoleUrl(podId: string): string {
	return `https://runpod.io/console/pods/${podId}`;
}

function buildPodName(prefix: string, requestId: string): string {
	const safePrefix = prefix
		.toLowerCase()
		.replace(SAFE_PREFIX_PATTERN, "-")
		.replace(SAFE_PREFIX_BORDERS_PATTERN, "")
		.slice(0, POD_NAME_MAX_PREFIX_LENGTH);
	return `${safePrefix || "runpod-pod"}-${requestId.slice(0, REQUEST_ID_SHORT_LENGTH)}`;
}
