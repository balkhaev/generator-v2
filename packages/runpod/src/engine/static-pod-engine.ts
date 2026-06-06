import {
	buildPublicAssetUrl,
	type S3ObjectStat,
	type S3StorageConfig,
	statS3Object,
	uploadObjectToS3,
} from "@generator/storage";

import {
	type ComfyUIArtifactRef,
	type ComfyUIClient,
	type ComfyUIClientOptions,
	createComfyUIClient,
} from "../comfyui/client";
import {
	type ComfyProgressTracker,
	mergeRunningProgress,
	sharedComfyProgressTracker,
} from "../comfyui/progress-tracker";
import type { ComfyUIHistoryItem } from "../comfyui/types";
import type { PodWorkflow } from "../workflow/definition";
import {
	buildComfyArtifactKey,
	findEntryByClientId,
	isComfyTransientProxyError,
	pickPrimaryArtifact,
	queueContainsClientId,
	stringifyMessages,
	summarizeHistoryOutputs,
} from "./comfy-shared";
import type { Engine, EngineJob, EngineSubmission } from "./engine";

const STATIC_JOB_PREFIX = "static:";
const ARTIFACT_KEY_PREFIX = "generator-artifacts/runpod-static-pod";
const PROGRESS_PCT_PROMPT_QUEUED = 75;
const PROGRESS_PCT_PROMPT_RUNNING = 90;

type StaticCreateClient = (options: ComfyUIClientOptions) => ComfyUIClient;

export interface StaticPodEngineOptions<TInput, TOutput> {
	/** ComfyUI base URL фиксированного пода (без trailing slash обязательно). */
	comfyBaseUrl: string;
	createClient?: StaticCreateClient;
	logger?: Pick<Console, "info" | "warn">;
	/**
	 * Идентификатор пода — только для контекста parseOutput/console URL.
	 * Под не создаётся и не удаляется движком.
	 */
	podId?: string;
	progressTracker?: ComfyProgressTracker;
	randomRequestId?: () => string;
	s3: S3StorageConfig;
	statObject?: typeof statS3Object;
	uploadObject?: typeof uploadObjectToS3;
	workflow: PodWorkflow<TInput, TOutput>;
}

export function formatStaticJobId(requestId: string): string {
	return `${STATIC_JOB_PREFIX}${requestId}`;
}

export function parseStaticJobId(jobId: string): string {
	if (!jobId.startsWith(STATIC_JOB_PREFIX)) {
		throw new Error(
			`Static pod job id must start with "${STATIC_JOB_PREFIX}": ${jobId}`
		);
	}
	const requestId = jobId.slice(STATIC_JOB_PREFIX.length);
	if (requestId.length === 0) {
		throw new Error(`Static pod job id missing requestId: ${jobId}`);
	}
	return requestId;
}

/**
 * Движок для одного персистентного ComfyUI-пода. В отличие от
 * `createPodEngine` он НИКОГДА не создаёт и не удаляет под — ComfyUI всегда
 * запущен на фиксированном `comfyBaseUrl`. Состояние не хранится в памяти:
 * прогресс восстанавливается из ComfyUI `/queue` + `/history` по
 * `client_id == requestId`, а готовность — по наличию артефакта в S3.
 */
export function createStaticPodEngine<TInput, TOutput>(
	options: StaticPodEngineOptions<TInput, TOutput>
): Engine<TInput, TOutput> {
	const {
		comfyBaseUrl,
		createClient = createComfyUIClient,
		logger,
		progressTracker = sharedComfyProgressTracker,
		podId = "",
		randomRequestId = () => crypto.randomUUID(),
		s3,
		statObject = statS3Object,
		uploadObject = uploadObjectToS3,
		workflow,
	} = options;

	const client = createClient({ auth: "none", baseUrl: comfyBaseUrl });

	const checkArtifactStat = async (
		key: string
	): Promise<S3ObjectStat | null> => {
		try {
			const stat = await statObject(key, s3);
			return stat.sizeBytes > 0 ? stat : null;
		} catch {
			return null;
		}
	};

	const successResult = (
		jobId: string,
		output: TOutput
	): EngineJob & { output: TOutput } => ({
		errorSummary: null,
		jobId,
		lastLogLine: null,
		output,
		progressPct: 100,
		queuePosition: null,
		status: "succeeded",
	});

	const failedResult = (
		jobId: string,
		errorSummary: string
	): EngineJob & { output: null } => ({
		errorSummary,
		jobId,
		lastLogLine: null,
		output: null,
		progressPct: null,
		queuePosition: null,
		status: "failed",
	});

	const runningResult = (
		jobId: string,
		progressPct: number,
		lastLogLine: string | null = null
	): EngineJob & { output: null } => ({
		errorSummary: null,
		jobId,
		lastLogLine,
		output: null,
		progressPct,
		queuePosition: null,
		status: "running",
	});

	const buildLiveRunningResult = (
		jobId: string,
		requestId: string,
		fallbackPct: number,
		workflowGraph?: Record<string, unknown>
	): EngineJob & { output: null } => {
		const live = mergeRunningProgress({
			clientId: requestId,
			fallbackPct,
			tracker: progressTracker,
			tracking: {
				baseUrl: comfyBaseUrl,
				clientId: requestId,
				workflow: workflowGraph,
			},
		});
		return runningResult(jobId, live.progressPct, live.lastLogLine);
	};

	const downloadAndPersist = async (
		ref: ComfyUIArtifactRef,
		artifactKey: string
	): Promise<S3ObjectStat | null> => {
		const buffer = await client.downloadArtifact(ref);
		const data = new Uint8Array(buffer);
		await uploadObject(
			{
				contentType: workflow.artifactContentType,
				data,
				key: artifactKey,
				tmpPrefix: ARTIFACT_KEY_PREFIX,
			},
			s3
		);
		return checkArtifactStat(artifactKey);
	};

	const finalizeFromHistory = async (
		jobId: string,
		requestId: string,
		entry: ComfyUIHistoryItem,
		artifactKey: string
	): Promise<EngineJob & { output: TOutput | null }> => {
		const status = entry.status;
		if (status?.status_str === "error" || status?.status_str === "cancelled") {
			progressTracker.stopTracking(requestId);
			return failedResult(
				jobId,
				`ComfyUI workflow ${status.status_str}: ${stringifyMessages(status.messages)}`
			);
		}
		const artifactRef = pickPrimaryArtifact(entry.outputs);
		if (!artifactRef) {
			if (status?.completed) {
				const outputsSummary = summarizeHistoryOutputs(entry.outputs);
				const messagesSummary = stringifyMessages(status.messages);
				return failedResult(
					jobId,
					`ComfyUI workflow completed but produced no artifact (outputs: ${outputsSummary}; status: ${messagesSummary})`
				);
			}
			return buildLiveRunningResult(
				jobId,
				requestId,
				PROGRESS_PCT_PROMPT_RUNNING
			);
		}
		const stat = await downloadAndPersist(artifactRef, artifactKey);
		if (!stat) {
			progressTracker.stopTracking(requestId);
			return failedResult(
				jobId,
				`Failed to verify uploaded artifact at S3 key ${artifactKey}`
			);
		}
		const artifactPublicUrl = buildPublicAssetUrl(s3, artifactKey);
		const output = workflow.parseOutput({
			artifactPublicUrl,
			artifactStat: stat,
			podId,
			requestId,
			runpodPodConsoleUrl: podId
				? `https://runpod.io/console/pods/${podId}`
				: "",
		});
		progressTracker.stopTracking(requestId);
		return successResult(jobId, output);
	};

	const pollStatus = async (
		jobId: string,
		requestId: string,
		artifactKey: string
	): Promise<EngineJob & { output: TOutput | null }> => {
		try {
			const history = await client.getHistory();
			const entry = findEntryByClientId(history, requestId);
			if (entry) {
				return await finalizeFromHistory(jobId, requestId, entry, artifactKey);
			}
			const queue = await client.getQueue();
			if (queueContainsClientId(queue, requestId)) {
				return buildLiveRunningResult(
					jobId,
					requestId,
					PROGRESS_PCT_PROMPT_QUEUED
				);
			}
			// Ещё не появился ни в истории, ни в очереди — ComfyUI мог только что
			// принять prompt и не успел его зарегистрировать. Держим running,
			// общий timeout исполнения контролирует worker.
			return buildLiveRunningResult(
				jobId,
				requestId,
				PROGRESS_PCT_PROMPT_QUEUED
			);
		} catch (error) {
			if (isComfyTransientProxyError(error)) {
				logger?.warn?.("runpod-static-pod.comfyui-transient", {
					message: error instanceof Error ? error.message : String(error),
					requestId,
				});
				return buildLiveRunningResult(
					jobId,
					requestId,
					PROGRESS_PCT_PROMPT_RUNNING
				);
			}
			throw error;
		}
	};

	return {
		async cancel(jobId) {
			const requestId = parseStaticJobId(jobId);
			try {
				await client.authorizedFetch("/interrupt", { method: "POST" });
				logger?.info?.("runpod-static-pod.cancelled", { requestId });
			} catch (error) {
				logger?.warn?.("runpod-static-pod.cancel-failed", {
					message: error instanceof Error ? error.message : String(error),
					requestId,
				});
			}
		},

		async getStatus(jobId) {
			const requestId = parseStaticJobId(jobId);
			const artifactKey = buildComfyArtifactKey(
				ARTIFACT_KEY_PREFIX,
				requestId,
				workflow.artifactContentType
			);
			const existing = await checkArtifactStat(artifactKey);
			if (existing) {
				const artifactPublicUrl = buildPublicAssetUrl(s3, artifactKey);
				const output = workflow.parseOutput({
					artifactPublicUrl,
					artifactStat: existing,
					podId,
					requestId,
					runpodPodConsoleUrl: podId
						? `https://runpod.io/console/pods/${podId}`
						: "",
				});
				return successResult(jobId, output);
			}
			return await pollStatus(jobId, requestId, artifactKey);
		},

		async submit(input): Promise<EngineSubmission> {
			const parsed = workflow.inputSchema.parse(input);
			const requestId = randomRequestId();
			const built = await workflow.buildPrompt(parsed, {
				client,
				clientId: requestId,
				requestId,
			});
			await client.submitPrompt({
				clientId: requestId,
				extraData: { client_id: requestId },
				prompt: built.prompt,
			});
			progressTracker.ensureTracking({
				baseUrl: comfyBaseUrl,
				clientId: requestId,
				totalNodes: Object.keys(built.prompt).length,
				workflow: built.prompt,
			});
			logger?.info?.("runpod-static-pod.submitted", {
				requestId,
				workflowId: workflow.id,
			});
			return {
				jobId: formatStaticJobId(requestId),
				queuePosition: null,
				rawProviderJobReference: requestId,
				status: "queued",
			};
		},
	} satisfies Engine<TInput, TOutput> & {
		getStatus(jobId: string): Promise<EngineJob & { output: TOutput | null }>;
	};
}
