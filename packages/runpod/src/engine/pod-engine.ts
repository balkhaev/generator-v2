import {
	buildPublicAssetUrl,
	type S3ObjectStat,
	type S3StorageConfig,
	statS3Object,
	uploadObjectToS3,
} from "@generator/storage";

import type { CreatePodInput, PodSnapshot, RunpodPodsApi } from "../api/pods";
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
import { isNoCapacityError } from "../http/client";
import type {
	PodNetworkVolume,
	PodPrepareStatus,
	PodWorkflow,
} from "../workflow/definition";
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
import {
	type ActivePodRegistry,
	createNoopActivePodRegistry,
	createNoopPodInputStore,
	createNoopStickyVolumeStore,
	createNoopWarmPodPool,
	type PodInputStore,
	type StickyVolumeStore,
	type WarmPodEntry,
	type WarmPodPool,
} from "./warm-pod-pool";

const POD_JOB_SEPARATOR = ":";
const ARTIFACT_KEY_PREFIX = "generator-artifacts/runpod-pod";
const SAFE_PREFIX_PATTERN = /[^a-z0-9-]+/gu;
const SAFE_PREFIX_BORDERS_PATTERN = /^-+|-+$/gu;
const POD_NAME_MAX_PREFIX_LENGTH = 48;
const REQUEST_ID_SHORT_LENGTH = 8;
const COMFYUI_USERNAME = "agent";
const COMFYUI_PORT = 8188;
const POD_INPUT_ENV_KEY = "INFERENCE_INPUT_JSON_B64";
const POD_TIMEOUT_ENV_KEY = "INFERENCE_TIMEOUT_S";
const POD_NETWORK_VOLUME_ENV_KEY = "INFERENCE_NETWORK_VOLUME_ID";
const INPUT_STORE_TTL_MS_DEFAULT = 6 * 60 * 60 * 1000;
const PROGRESS_PCT_POD_BOOTING = 5;
const PROGRESS_PCT_COMFY_PROVISIONING = 30;
const PROGRESS_PCT_PREPARE = 60;
const PROGRESS_PCT_PROMPT_QUEUED = 75;
const PROGRESS_PCT_PROMPT_RUNNING = 90;

const POD_NOT_FOUND_PATTERN = /\/pods\/[^\s]+\s*\(get\) failed \(404\)/u;

export function isPodNotFoundError(error: unknown): boolean {
	return error instanceof Error && POD_NOT_FOUND_PATTERN.test(error.message);
}

type PodCreateClient = (options: ComfyUIClientOptions) => ComfyUIClient;

interface PodEngineDeps {
	/**
	 * Tracks every pod the engine *owns* right now (created, not yet released
	 * to warm-pool or cleaned up). Reaper merges this with `warmPool` to build
	 * its protected set; pods present in either store are immune to age-based
	 * reaping. Default = noop registry, which means reaper falls back to pure
	 * `safetyAgeMs` heuristic — fine for single-process, fragile for
	 * multi-replica or long cold starts.
	 */
	activeRegistry?: ActivePodRegistry;
	api: RunpodPodsApi;
	createClient?: PodCreateClient;
	/**
	 * Cross-process cache for per-request input payloads. Required when
	 * `keepAliveMs > 0` because reused pods cannot receive a fresh env. Default
	 * is in-memory noop, which only works for disposable pods.
	 */
	inputStore?: PodInputStore;
	logger?: Pick<Console, "info" | "warn">;
	now?: () => Date;
	progressTracker?: ComfyProgressTracker;
	randomPassword?: () => string;
	randomRequestId?: () => string;
	s3: S3StorageConfig;
	statObject?: typeof statS3Object;
	/**
	 * Per-execution mapping "stickyKey → networkVolumeId". On submit we try
	 * the cached volume first so retries land on a node that already has the
	 * model files warm in the NFS cache. Default = noop store (no stickiness).
	 */
	stickyStore?: StickyVolumeStore;
	uploadObject?: typeof uploadObjectToS3;
	/**
	 * Warm-pod pool. When workflow declares `pod.keepAliveMs > 0`, successful
	 * exec'es return the pod here instead of terminating; subsequent submits
	 * claim from the pool and skip ComfyUI cold boot entirely. Default = noop
	 * (every submit creates a fresh pod, current behaviour).
	 */
	warmPool?: WarmPodPool;
}

interface PodEngineOptions<TInput, TOutput> extends PodEngineDeps {
	civitaiApiKey?: string;
	hfToken?: string;
	workflow: PodWorkflow<TInput, TOutput>;
}

interface ParsedPodJobId {
	password: string;
	podId: string;
	requestId: string;
}

export function formatPodJobId(input: ParsedPodJobId): string {
	return [input.podId, input.requestId, input.password].join(POD_JOB_SEPARATOR);
}

export function parsePodJobId(jobId: string): ParsedPodJobId {
	const parts = jobId.split(POD_JOB_SEPARATOR);
	if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
		throw new Error(
			"RunPod pod job id must be formatted as podId:requestId:password"
		);
	}
	const [podId, requestId, password] = parts as [string, string, string];
	return { password, podId, requestId };
}

/**
 * Disposable pod runtime. Lifecycle (driven by external worker via
 * sequential `getStatus()` polls):
 *
 * 1. `submit` создаёт pod на RunPod template (без override `dockerStartCmd`),
 *    кладёт в env пода JSON-сериализованный input, password для ComfyUI-Login
 *    и опциональные CIVITAI_TOKEN/HF_TOKEN; возвращает `queued`.
 * 2. `getStatus` каждый цикл доходит до текущей точки state-machine:
 *    - S3 уже содержит артефакт → `succeeded` + cleanup (idempotent).
 *    - pod EXITED/TERMINATED без артефакта → `failed` + cleanup.
 *    - ComfyUI ещё не отвечает → `running 5%`.
 *    - workflows из template ещё не подтянулись → `running 30%`.
 *    - `workflow.prepare` (например, скачивание LoRA с Civitai) ещё бежит →
 *      `running 30..60%`.
 *    - `/prompt` ещё не сабмичен → сабмитим (idempotent через client_id).
 *    - prompt в очереди/выполняется → `running 75..90%`.
 *    - prompt завершён в /history → качаем artifact из ComfyUI, кладём в S3,
 *      убиваем pod → `succeeded`.
 *
 * State не хранится в памяти worker'а: всё восстанавливается из RunPod
 * snapshot (env пода) и ComfyUI /queue + /history (по client_id =
 * requestId).
 */
export function createPodEngine<TInput, TOutput>(
	options: PodEngineOptions<TInput, TOutput>
): Engine<TInput, TOutput> {
	const {
		activeRegistry = createNoopActivePodRegistry(),
		api,
		civitaiApiKey,
		createClient = createComfyUIClient,
		hfToken,
		inputStore = createNoopPodInputStore(),
		logger,
		now = () => new Date(),
		progressTracker = sharedComfyProgressTracker,
		randomPassword = generatePassword,
		randomRequestId = () => crypto.randomUUID(),
		s3,
		statObject = statS3Object,
		stickyStore = createNoopStickyVolumeStore(),
		uploadObject = uploadObjectToS3,
		warmPool = createNoopWarmPodPool(),
		workflow,
	} = options;
	// Keep the sticky entry alive longer than a single submit so retries
	// triggered by Phase 1 (capacity-throttle re-queue) and follow-up syncs
	// stay on the same volume. 30 min is enough for most LTX-2.3 runs end-to-end.
	const stickyVolumeTtlMs = 30 * 60 * 1000;
	const keepAliveMs = workflow.pod.keepAliveMs ?? 0;
	const reuseEnabled = keepAliveMs > 0;
	const inputStoreTtlMs = Math.max(
		keepAliveMs + 60_000,
		INPUT_STORE_TTL_MS_DEFAULT
	);
	// active registry entry should outlive the worst-case execution: pod timeout
	// (if any) + a small buffer so worker crashes between create and finalize
	// don't leak orphans into reap-eligible territory. When pod has no explicit
	// timeout (legacy workflows) we fall back to a generous 2h default.
	const activeRegistryTtlMs =
		(workflow.pod.timeoutMs ?? 2 * 60 * 60 * 1000) + 5 * 60 * 1000;

	const trackActivePod = async (entry: {
		networkVolumeId: string;
		podId: string;
	}): Promise<void> => {
		try {
			await activeRegistry.add(
				{
					networkVolumeId: entry.networkVolumeId,
					podId: entry.podId,
					registeredAt: new Date().toISOString(),
					workflowId: workflow.id,
				},
				activeRegistryTtlMs
			);
		} catch (error) {
			logger?.warn?.("runpod-pod.active-registry.add-failed", {
				message: error instanceof Error ? error.message : "unknown",
				podId: entry.podId,
			});
		}
	};

	const untrackActivePod = async (podId: string): Promise<void> => {
		try {
			await activeRegistry.remove(podId);
		} catch {
			// Best-effort: stale entries expire on their own.
		}
	};

	const cleanupPod = async (
		podId: string,
		reason: string,
		requestId?: string
	) => {
		if (reuseEnabled) {
			await warmPool.forget(workflow.id, podId).catch(() => {
				// Pool cleanup is best-effort. Reaper picks up orphans eventually.
			});
		}
		if (requestId) {
			await inputStore.delete(requestId).catch(() => {
				// Best-effort; store entries expire on their own TTL anyway.
			});
		}
		// Drop active-registry entry first so reaper never races a cleanup that
		// also `api.delete`s the pod.
		await untrackActivePod(podId);
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

	const releaseOrCleanup = async (
		ctx: {
			networkVolumeId: string | undefined;
			password: string;
			podId: string;
			requestId: string;
		},
		failureReason: string
	): Promise<void> => {
		if (!(reuseEnabled && ctx.networkVolumeId)) {
			await cleanupPod(ctx.podId, failureReason, ctx.requestId);
			return;
		}
		try {
			await warmPool.release(
				workflow.id,
				{
					networkVolumeId: ctx.networkVolumeId,
					password: ctx.password,
					podId: ctx.podId,
				},
				keepAliveMs
			);
			// Pod ownership transfers from "active" → "warm". Reaper now protects
			// it via the warm-pool entry, so drop the active registry record to
			// avoid double-counting/double-protecting beyond keepAliveMs.
			await untrackActivePod(ctx.podId);
			await inputStore.delete(ctx.requestId).catch(() => {
				// Best-effort: input is per-request and TTLed in the store anyway.
			});
			logger?.info?.("runpod-pod.released-to-warm-pool", {
				keepAliveMs,
				networkVolumeId: ctx.networkVolumeId,
				podId: ctx.podId,
				requestId: ctx.requestId,
				workflowId: workflow.id,
			});
		} catch (error) {
			logger?.warn?.("runpod-pod.warm-pool-release-failed", {
				message: error instanceof Error ? error.message : "unknown",
				podId: ctx.podId,
				requestId: ctx.requestId,
				workflowId: workflow.id,
			});
			await cleanupPod(ctx.podId, "warm-pool-release-failed", ctx.requestId);
		}
	};

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

	const buildClient = (podId: string, password: string): ComfyUIClient =>
		createClient({
			baseUrl: comfyBaseUrlForPod(podId),
			password,
			username: COMFYUI_USERNAME,
		});

	const comfyBaseUrlForPod = (podId: string): string =>
		`https://${podId}-${COMFYUI_PORT}.proxy.runpod.net`;

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

	const buildLiveRunningResult = (input: {
		client: ComfyUIClient;
		fallbackPct: number;
		jobId: string;
		podId: string;
		requestId: string;
		workflowGraph?: Record<string, unknown>;
	}): EngineJob & { output: null } => {
		const live = mergeRunningProgress({
			clientId: input.requestId,
			fallbackPct: input.fallbackPct,
			tracker: progressTracker,
			tracking: {
				baseUrl: comfyBaseUrlForPod(input.podId),
				clientId: input.requestId,
				cookieHeader: input.client.getSessionCookie(),
				workflow: input.workflowGraph,
			},
		});
		return runningResult(input.jobId, live.progressPct, live.lastLogLine);
	};

	const downloadAndPersist = async (
		client: ComfyUIClient,
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

	const handleHistoryEntry = async (args: {
		artifactKey: string;
		client: ComfyUIClient;
		entry: ComfyUIHistoryItem;
		jobId: string;
		networkVolumeId: string | undefined;
		password: string;
		podId: string;
		requestId: string;
	}): Promise<EngineJob & { output: TOutput | null }> => {
		const {
			artifactKey,
			client,
			entry,
			jobId,
			networkVolumeId,
			password,
			podId,
			requestId,
		} = args;
		const status = entry.status;
		if (status?.status_str === "error" || status?.status_str === "cancelled") {
			// Pod state is suspect after workflow error — don't return to pool,
			// always cleanup so the next exec gets a fresh boot.
			await cleanupPod(podId, "comfyui-error", requestId);
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
				await cleanupPod(podId, "completed-without-artifact", requestId);
				progressTracker.stopTracking(requestId);
				return failedResult(
					jobId,
					`ComfyUI workflow completed but produced no artifact (outputs: ${outputsSummary}; status: ${messagesSummary})`
				);
			}
			return buildLiveRunningResult({
				client,
				fallbackPct: PROGRESS_PCT_PROMPT_RUNNING,
				jobId,
				podId,
				requestId,
			});
		}
		const stat = await downloadAndPersist(client, artifactRef, artifactKey);
		if (!stat) {
			progressTracker.stopTracking(requestId);
			return failedResult(
				jobId,
				`Failed to verify uploaded artifact at S3 key ${artifactKey}`
			);
		}
		await releaseOrCleanup(
			{ networkVolumeId, password, podId, requestId },
			"artifact-uploaded"
		);
		progressTracker.stopTracking(requestId);
		const artifactPublicUrl = buildPublicAssetUrl(s3, artifactKey);
		const output = workflow.parseOutput({
			artifactPublicUrl,
			artifactStat: stat,
			podId,
			requestId,
			runpodPodConsoleUrl: buildRunpodPodConsoleUrl(podId),
		});
		return successResult(jobId, output);
	};

	const tryComfyReady = async (client: ComfyUIClient): Promise<boolean> => {
		try {
			await client.getSystemStats();
			return true;
		} catch {
			return false;
		}
	};

	const submitPromptIfNeeded = async (
		client: ComfyUIClient,
		input: TInput,
		podId: string,
		requestId: string
	): Promise<{
		inFlight: boolean;
		submitted: boolean;
		workflowGraph?: Record<string, unknown>;
	}> => {
		const history = await client.getHistory();
		if (findEntryByClientId(history, requestId)) {
			return { inFlight: false, submitted: true };
		}
		const queue = await client.getQueue();
		if (queueContainsClientId(queue, requestId)) {
			return { inFlight: true, submitted: true };
		}
		const built = await workflow.buildPrompt(input, {
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
			baseUrl: comfyBaseUrlForPod(podId),
			clientId: requestId,
			cookieHeader: client.getSessionCookie(),
			totalNodes: Object.keys(built.prompt).length,
			workflow: built.prompt,
		});
		return {
			inFlight: true,
			submitted: true,
			workflowGraph: built.prompt,
		};
	};

	const tryReadyPodSnapshot = async (
		jobId: string,
		podId: string
	): Promise<
		| { kind: "alive"; pod: PodSnapshot & { env?: Record<string, string> } }
		| { kind: "result"; value: EngineJob & { output: TOutput | null } }
	> => {
		try {
			const pod = (await api.get(podId)) as PodSnapshot & {
				env?: Record<string, string>;
			};
			const desiredStatus = pod.desiredStatus ?? "RUNNING";
			if (desiredStatus === "EXITED" || desiredStatus === "TERMINATED") {
				await cleanupPod(podId, "terminated-without-artifact");
				return {
					kind: "result",
					value: failedResult(
						jobId,
						`RunPod pod ${podId} exited (${desiredStatus}) without producing an artifact`
					),
				};
			}
			return { kind: "alive", pod };
		} catch (error) {
			if (isPodNotFoundError(error)) {
				logger?.warn?.("runpod-pod.vanished", {
					message: error instanceof Error ? error.message : String(error),
					podId,
				});
				return {
					kind: "result",
					value: failedResult(
						jobId,
						`RunPod pod ${podId} vanished from RunPod inventory before finishing — likely auto-terminated due to a container crash, OOM, or platform preemption. Check the pod logs in the RunPod console for details.`
					),
				};
			}
			return {
				kind: "result",
				value: failedResult(
					jobId,
					error instanceof Error
						? error.message
						: `RunPod pod ${podId} disappeared`
				),
			};
		}
	};

	const podAgeMs = (pod: PodSnapshot): number | null => {
		if (!pod.lastStatusChange) {
			return null;
		}
		const parsed = Date.parse(pod.lastStatusChange);
		if (Number.isNaN(parsed)) {
			return null;
		}
		return now().getTime() - parsed;
	};

	const failTimedOutPod = async (
		jobId: string,
		pod: PodSnapshot,
		requestId: string
	): Promise<(EngineJob & { output: null }) | null> => {
		const timeoutMs = workflow.pod.timeoutMs;
		if (!timeoutMs) {
			return null;
		}
		const ageMs = podAgeMs(pod);
		if (ageMs === null || ageMs < timeoutMs) {
			return null;
		}
		await cleanupPod(pod.id, "timeout", requestId);
		return failedResult(
			jobId,
			`RunPod pod ${pod.id} timed out after ${timeoutMs}ms without producing an artifact`
		);
	};

	const decodeInputForRequest = async (
		jobId: string,
		podId: string,
		requestId: string,
		encodedInput: string | undefined
	): Promise<
		| { input: TInput; kind: "ok" }
		| { kind: "result"; value: EngineJob & { output: null } }
	> => {
		// Reused pods carry env from their original submit, so prefer the
		// per-request store. Fresh pods fall back to the env they were created
		// with. Either path yields a Zod-validated input.
		const fromStore = (await inputStore
			.get<unknown>(requestId)
			.catch(() => null)) as unknown;
		if (fromStore !== null && fromStore !== undefined) {
			try {
				return {
					input: workflow.inputSchema.parse(fromStore),
					kind: "ok",
				};
			} catch (error) {
				return {
					kind: "result",
					value: failedResult(
						jobId,
						`Failed to decode INFERENCE_INPUT from store: ${
							error instanceof Error ? error.message : String(error)
						}`
					),
				};
			}
		}
		if (!encodedInput) {
			return {
				kind: "result",
				value: failedResult(
					jobId,
					`Pod ${podId} env is missing ${POD_INPUT_ENV_KEY} and no entry was found in the input store for request ${requestId}`
				),
			};
		}
		try {
			return {
				input: workflow.inputSchema.parse(decodeBase64Json(encodedInput)),
				kind: "ok",
			};
		} catch (error) {
			return {
				kind: "result",
				value: failedResult(
					jobId,
					`Failed to decode INFERENCE_INPUT: ${
						error instanceof Error ? error.message : String(error)
					}`
				),
			};
		}
	};

	const runPrepareStep = async (
		jobId: string,
		podId: string,
		client: ComfyUIClient,
		input: TInput,
		requestId: string
	): Promise<(EngineJob & { output: TOutput | null }) | null> => {
		if (!workflow.prepare) {
			return null;
		}
		let prepareStatus: PodPrepareStatus;
		try {
			prepareStatus = await workflow.prepare({
				civitaiApiKey,
				client,
				downloadId: requestId,
				input,
				requestId,
			});
		} catch (error) {
			await cleanupPod(podId, "prepare-failed", requestId);
			return failedResult(
				jobId,
				`workflow.prepare failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
		if (prepareStatus.errorSummary) {
			await cleanupPod(podId, "prepare-error", requestId);
			return failedResult(jobId, prepareStatus.errorSummary);
		}
		if (!prepareStatus.ready) {
			return runningResult(
				jobId,
				clamp(
					PROGRESS_PCT_COMFY_PROVISIONING +
						((prepareStatus.progressPct ?? 0) *
							(PROGRESS_PCT_PREPARE - PROGRESS_PCT_COMFY_PROVISIONING)) /
							100,
					PROGRESS_PCT_COMFY_PROVISIONING,
					PROGRESS_PCT_PREPARE
				)
			);
		}
		return null;
	};

	// Завернули post-snapshot часть getStatus в guard: транзиентные 5xx от
	// RunPod proxy (Cloudflare) возвращаем как `running`, не давая упасть
	// в worker retry → потеря контекста (типичный случай: 502 на /history,
	// retry → api.get → 404 → бесполезный «pod not found»).
	const runWithTransientGuard = async (args: {
		artifactKey: string;
		client: ComfyUIClient;
		input: TInput;
		jobId: string;
		networkVolumeId: string | undefined;
		password: string;
		podId: string;
		requestId: string;
	}): Promise<EngineJob & { output: TOutput | null }> => {
		const {
			artifactKey,
			client,
			input,
			jobId,
			networkVolumeId,
			password,
			podId,
			requestId,
		} = args;
		try {
			const prepareResult = await runPrepareStep(
				jobId,
				podId,
				client,
				input,
				requestId
			);
			if (prepareResult) {
				return prepareResult;
			}

			const submission = await submitPromptIfNeeded(
				client,
				input,
				podId,
				requestId
			);
			if (!submission.submitted || submission.inFlight) {
				return buildLiveRunningResult({
					client,
					fallbackPct: PROGRESS_PCT_PROMPT_QUEUED,
					jobId,
					podId,
					requestId,
					workflowGraph: submission.workflowGraph,
				});
			}

			const history = await client.getHistory();
			const entry = findEntryByClientId(history, requestId);
			if (!entry) {
				return buildLiveRunningResult({
					client,
					fallbackPct: PROGRESS_PCT_PROMPT_RUNNING,
					jobId,
					podId,
					requestId,
					workflowGraph: submission.workflowGraph,
				});
			}
			return await handleHistoryEntry({
				artifactKey,
				client,
				entry,
				jobId,
				networkVolumeId,
				password,
				podId,
				requestId,
			});
		} catch (error) {
			if (isComfyTransientProxyError(error)) {
				logger?.warn?.("runpod-pod.comfyui-transient", {
					message: error instanceof Error ? error.message : String(error),
					podId,
					requestId,
				});
				return buildLiveRunningResult({
					client,
					fallbackPct: PROGRESS_PCT_PROMPT_RUNNING,
					jobId,
					podId,
					requestId,
				});
			}
			throw error;
		}
	};

	const verifyWarmPodAlive = async (entry: WarmPodEntry): Promise<boolean> => {
		try {
			const snapshot = await api.get(entry.podId);
			const desired = snapshot.desiredStatus ?? "RUNNING";
			return desired !== "EXITED" && desired !== "TERMINATED";
		} catch (error) {
			logger?.warn?.("runpod-pod.warm-pool-verify-failed", {
				message: error instanceof Error ? error.message : String(error),
				podId: entry.podId,
				workflowId: workflow.id,
			});
			return false;
		}
	};

	const tryReuseWarmPod = async (
		input: TInput,
		requestId: string
	): Promise<WarmPodEntry | null> => {
		if (!reuseEnabled) {
			return null;
		}
		// Loop because a stale entry may be claimed; we forget it and try the
		// next one. Bounded by pool size — claim returns null when empty.
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const candidate = await warmPool.claim(workflow.id);
			if (!candidate) {
				return null;
			}
			if (await verifyWarmPodAlive(candidate)) {
				await inputStore.put(requestId, input, inputStoreTtlMs);
				logger?.info?.("runpod-pod.reused-from-warm-pool", {
					networkVolumeId: candidate.networkVolumeId,
					podId: candidate.podId,
					requestId,
					workflowId: workflow.id,
				});
				return candidate;
			}
			await warmPool.forget(workflow.id, candidate.podId).catch(() => {
				// Best-effort: the entry was already claimed-out anyway.
			});
		}
		return null;
	};

	return {
		async cancel(jobId) {
			const { podId, requestId } = parsePodJobId(jobId);
			await cleanupPod(podId, "cancelled", requestId);
		},

		async getStatus(jobId) {
			const { password, podId, requestId } = parsePodJobId(jobId);
			const artifactKey = buildArtifactKey(requestId, workflow);

			const existing = await checkArtifactStat(artifactKey);
			if (existing) {
				// Don't blindly cleanup — if reuse is on, the pod is probably already
				// back in the pool serving the next exec. Just drop the input cache.
				if (reuseEnabled) {
					await inputStore.delete(requestId).catch(() => {
						// Best-effort
					});
				} else {
					await cleanupPod(podId, "artifact-already-in-s3", requestId);
				}
				const artifactPublicUrl = buildPublicAssetUrl(s3, artifactKey);
				const output = workflow.parseOutput({
					artifactPublicUrl,
					artifactStat: existing,
					podId,
					requestId,
					runpodPodConsoleUrl: buildRunpodPodConsoleUrl(podId),
				});
				return successResult(jobId, output);
			}

			const podSnapshot = await tryReadyPodSnapshot(jobId, podId);
			if (podSnapshot.kind === "result") {
				return podSnapshot.value;
			}
			const { pod } = podSnapshot;
			const timedOut = await failTimedOutPod(jobId, pod, requestId);
			if (timedOut) {
				return timedOut;
			}
			const networkVolumeId = pod.env?.[POD_NETWORK_VOLUME_ENV_KEY];

			const client = buildClient(podId, password);
			if (!(await tryComfyReady(client))) {
				return runningResult(jobId, PROGRESS_PCT_POD_BOOTING);
			}

			const decoded = await decodeInputForRequest(
				jobId,
				podId,
				requestId,
				pod.env?.[POD_INPUT_ENV_KEY]
			);
			if (decoded.kind === "result") {
				await cleanupPod(podId, "input-decode-failed", requestId);
				return decoded.value;
			}

			return await runWithTransientGuard({
				artifactKey,
				client,
				input: decoded.input,
				jobId,
				networkVolumeId,
				password,
				podId,
				requestId,
			});
		},

		async submit(input, submitOptions): Promise<EngineSubmission> {
			const parsed = workflow.inputSchema.parse(input);
			const requestId = randomRequestId();
			const stickyKey = submitOptions?.stickyKey;
			const reused = await tryReuseWarmPod(parsed, requestId);
			if (reused) {
				// Reused pod was protected by warm-pool entry; now it's serving an
				// exec again, so it belongs to active registry until release.
				await trackActivePod({
					networkVolumeId: reused.networkVolumeId,
					podId: reused.podId,
				});
				// Reuse keeps us on the same volume as last time — refresh sticky
				// TTL so a subsequent retry path still benefits.
				if (stickyKey) {
					await stickyStore
						.set(stickyKey, reused.networkVolumeId, stickyVolumeTtlMs)
						.catch(() => {
							// Best-effort: missing sticky just means next submit
							// picks a volume via round-robin again.
						});
				}
				return {
					jobId: formatPodJobId({
						password: reused.password,
						podId: reused.podId,
						requestId,
					}),
					queuePosition: null,
					rawProviderJobReference: reused.podId,
					status: "queued",
				};
			}
			const password = randomPassword();
			const baseEnv = workflow.buildEnv?.(parsed) ?? {};
			const env: Record<string, string> = {
				...baseEnv,
				PASSWORD: password,
				[POD_INPUT_ENV_KEY]: encodeBase64Json(parsed),
			};
			if (civitaiApiKey) {
				env.CIVITAI_TOKEN = civitaiApiKey;
				env.CIVITAI_API_KEY = civitaiApiKey;
			}
			if (hfToken) {
				env.HF_TOKEN = hfToken;
			}
			if (workflow.pod.timeoutMs) {
				env[POD_TIMEOUT_ENV_KEY] = String(
					Math.ceil(workflow.pod.timeoutMs / 1000)
				);
			}
			// Sticky volume preference: on retry of the same execution, try the
			// volume that served us last time first. Models are already on the
			// NFS cache there, so we skip the multi-minute "download to volume"
			// step. Fallback is automatic — createPodAcrossVolumes walks the
			// full list if sticky is itself out of capacity.
			const stickyVolumeId = stickyKey
				? await stickyStore.get(stickyKey).catch(() => null)
				: null;
			const orderedVolumes = stickyVolumeId
				? reorderVolumesByPreferred(workflow.pod.networkVolumes, stickyVolumeId)
				: workflow.pod.networkVolumes;
			const { pod, networkVolumeId } = await createPodAcrossVolumes(
				api,
				(volume) => ({
					cloudType: workflow.pod.cloudType,
					containerDiskInGb: workflow.pod.containerDiskInGb,
					env: {
						...env,
						[POD_NETWORK_VOLUME_ENV_KEY]: volume.networkVolumeId,
					},
					gpuCount: workflow.pod.gpuCount ?? 1,
					imageName: workflow.pod.imageName,
					name: buildPodName(workflow.pod.namePrefix ?? workflow.id, requestId),
					ports: [`${COMFYUI_PORT}/http`, "22/tcp"],
					supportPublicIp: false,
					templateId: workflow.pod.templateId,
					volumeInGb: workflow.pod.volumeInGb,
					volumeMountPath: "/workspace",
				}),
				orderedVolumes,
				logger,
				requestId,
				workflow.id
			);
			// Register *before* returning so any subsequent reaper tick already
			// sees this pod as protected. inputStore put is async-ish but cheap.
			await trackActivePod({ networkVolumeId, podId: pod.id });
			if (stickyKey) {
				await stickyStore
					.set(stickyKey, networkVolumeId, stickyVolumeTtlMs)
					.catch((error) => {
						logger?.warn?.("runpod-pod.sticky-volume.set-failed", {
							message: error instanceof Error ? error.message : "unknown",
							networkVolumeId,
							stickyKey,
						});
					});
			}
			if (reuseEnabled) {
				// Mirror the new input into the side-channel so this exec and any
				// subsequent reused exec follow the same lookup path.
				await inputStore.put(requestId, parsed, inputStoreTtlMs);
			}
			logger?.info?.("runpod-pod.started", {
				networkVolumeId,
				podId: pod.id,
				requestId,
				templateId: workflow.pod.templateId,
				workflowId: workflow.id,
			});
			return {
				jobId: formatPodJobId({ password, podId: pod.id, requestId }),
				queuePosition: null,
				rawProviderJobReference: pod.id,
				status: "queued",
			};
		},
	} satisfies Engine<TInput, TOutput> & {
		getStatus(jobId: string): Promise<EngineJob & { output: TOutput | null }>;
	};
}

type PodLogger = PodEngineDeps["logger"];

export type PodCreatePayloadForVolume = (
	volume: PodNetworkVolume
) => Omit<CreatePodInput, "gpuTypeIds" | "networkVolumeId">;

/**
 * Создаёт под, перебирая network-volume'ы из workflow'а. Каждый volume привязан
 * к одному RunPod DC и списку GPU-типов, доступных в этом DC. Если по
 * текущему volume RunPod вернул `no capacity` для всех его GPU — пробуем
 * следующий. Без volume вообще не работаем: смысл всей этой конструкции — не
 * качать ~40 ГБ моделей на каждый cold start.
 *
 * `payloadForVolume` строит payload per-volume — даёт возможность подставить
 * id volume'а в env пода, чтобы getStatus мог восстановить его без отдельного
 * persisted state.
 */
export async function createPodAcrossVolumes(
	api: RunpodPodsApi,
	payloadForVolume: PodCreatePayloadForVolume,
	volumes: readonly PodNetworkVolume[],
	logger: PodLogger,
	requestId: string,
	workflowId: string
): Promise<{ networkVolumeId: string; pod: PodSnapshot }> {
	if (volumes.length === 0) {
		throw new Error(
			`runpod-pod (${workflowId}): no network volumes configured; cannot create pod`
		);
	}
	const errors: string[] = [];
	for (const volume of volumes) {
		try {
			const pod = await api.create({
				...payloadForVolume(volume),
				gpuTypeIds: volume.gpuTypeIds,
				networkVolumeId: volume.networkVolumeId,
			});
			return { networkVolumeId: volume.networkVolumeId, pod };
		} catch (error) {
			if (!isNoCapacityError(error)) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			const label = volume.label ?? volume.networkVolumeId;
			errors.push(`${label}: ${message}`);
			logger?.warn?.("runpod-pod.network-volume-skip", {
				label,
				message,
				networkVolumeId: volume.networkVolumeId,
				requestId,
				workflowId,
			});
		}
	}
	throw new Error(
		`runpod-pod (${workflowId}): no capacity across ${volumes.length} network volume(s):\n  - ${errors.join("\n  - ")}`
	);
}

/**
 * Returns `volumes` with `preferredId` moved to the front while preserving
 * the original relative order of the rest. If `preferredId` isn't part of
 * `volumes`, returns the input unchanged — sticky entry referencing a
 * removed/retired volume is treated as a cache miss, not an error.
 */
export function reorderVolumesByPreferred(
	volumes: readonly PodNetworkVolume[],
	preferredId: string
): readonly PodNetworkVolume[] {
	const idx = volumes.findIndex((v) => v.networkVolumeId === preferredId);
	if (idx <= 0) {
		return volumes;
	}
	const preferred = volumes[idx];
	if (!preferred) {
		return volumes;
	}
	return [preferred, ...volumes.slice(0, idx), ...volumes.slice(idx + 1)];
}

function buildArtifactKey(
	requestId: string,
	workflow: PodWorkflow<unknown, unknown>
): string {
	return buildComfyArtifactKey(
		ARTIFACT_KEY_PREFIX,
		requestId,
		workflow.artifactContentType
	);
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

function encodeBase64Json(value: unknown): string {
	const json = JSON.stringify(value);
	return Buffer.from(json, "utf8").toString("base64");
}

function decodeBase64Json(encoded: string): unknown {
	const json = Buffer.from(encoded, "base64").toString("utf8");
	return JSON.parse(json);
}

function clamp(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return Math.round(value);
}

function generatePassword(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
