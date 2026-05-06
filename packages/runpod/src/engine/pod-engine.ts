import {
	buildPublicAssetUrl,
	type S3ObjectStat,
	type S3StorageConfig,
	statS3Object,
	uploadObjectToS3,
} from "@generator/storage";

import type { PodSnapshot, RunpodPodsApi } from "../api/pods";
import {
	type ComfyUIArtifactRef,
	type ComfyUIClient,
	type ComfyUIClientOptions,
	createComfyUIClient,
} from "../comfyui/client";
import type {
	ComfyUIHistoryItem,
	ComfyUIQueueItem,
	ComfyUIQueueResponse,
} from "../comfyui/types";
import type { PodPrepareStatus, PodWorkflow } from "../workflow/definition";
import type { Engine, EngineJob, EngineSubmission } from "./engine";

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
const PROGRESS_PCT_POD_BOOTING = 5;
const PROGRESS_PCT_COMFY_PROVISIONING = 30;
const PROGRESS_PCT_PREPARE = 60;
const PROGRESS_PCT_PROMPT_QUEUED = 75;
const PROGRESS_PCT_PROMPT_RUNNING = 90;

type PodCreateClient = (options: ComfyUIClientOptions) => ComfyUIClient;

interface PodEngineDeps {
	api: RunpodPodsApi;
	createClient?: PodCreateClient;
	logger?: Pick<Console, "info" | "warn">;
	now?: () => Date;
	randomPassword?: () => string;
	randomRequestId?: () => string;
	s3: S3StorageConfig;
	statObject?: typeof statS3Object;
	uploadObject?: typeof uploadObjectToS3;
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
		api,
		civitaiApiKey,
		createClient = createComfyUIClient,
		hfToken,
		logger,
		randomPassword = generatePassword,
		randomRequestId = () => crypto.randomUUID(),
		s3,
		statObject = statS3Object,
		uploadObject = uploadObjectToS3,
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
			baseUrl: `https://${podId}-${COMFYUI_PORT}.proxy.runpod.net`,
			password,
			username: COMFYUI_USERNAME,
		});

	const successResult = (
		jobId: string,
		output: TOutput
	): EngineJob & { output: TOutput } => ({
		errorSummary: null,
		jobId,
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
		output: null,
		progressPct: null,
		queuePosition: null,
		status: "failed",
	});

	const runningResult = (
		jobId: string,
		progressPct: number
	): EngineJob & { output: null } => ({
		errorSummary: null,
		jobId,
		output: null,
		progressPct,
		queuePosition: null,
		status: "running",
	});

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

	const handleHistoryEntry = async (
		jobId: string,
		entry: ComfyUIHistoryItem,
		client: ComfyUIClient,
		podId: string,
		requestId: string,
		artifactKey: string
	): Promise<EngineJob & { output: TOutput | null }> => {
		const status = entry.status;
		if (status?.status_str === "error" || status?.status_str === "cancelled") {
			await cleanupPod(podId, "comfyui-error");
			return failedResult(
				jobId,
				`ComfyUI workflow ${status.status_str}: ${stringifyMessages(status.messages)}`
			);
		}
		const artifactRef = pickPrimaryArtifact(entry.outputs);
		if (!artifactRef) {
			if (status?.completed) {
				await cleanupPod(podId, "completed-without-artifact");
				return failedResult(
					jobId,
					"ComfyUI workflow completed but produced no artifact"
				);
			}
			return runningResult(jobId, PROGRESS_PCT_PROMPT_RUNNING);
		}
		const stat = await downloadAndPersist(client, artifactRef, artifactKey);
		if (!stat) {
			return failedResult(
				jobId,
				`Failed to verify uploaded artifact at S3 key ${artifactKey}`
			);
		}
		await cleanupPod(podId, "artifact-uploaded");
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
		requestId: string
	): Promise<{ inFlight: boolean; submitted: boolean }> => {
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
		return { inFlight: true, submitted: true };
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

	const decodeInputFromPod = (
		jobId: string,
		podId: string,
		encodedInput: string | undefined
	):
		| { kind: "ok"; input: TInput }
		| { kind: "result"; value: EngineJob & { output: null } } => {
		if (!encodedInput) {
			return {
				kind: "result",
				value: failedResult(
					jobId,
					`Pod ${podId} env is missing ${POD_INPUT_ENV_KEY}`
				),
			};
		}
		try {
			return {
				kind: "ok",
				input: workflow.inputSchema.parse(decodeBase64Json(encodedInput)),
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
				client,
				downloadId: requestId,
				input,
				requestId,
			});
		} catch (error) {
			await cleanupPod(podId, "prepare-failed");
			return failedResult(
				jobId,
				`workflow.prepare failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
		if (prepareStatus.errorSummary) {
			await cleanupPod(podId, "prepare-error");
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

	return {
		async cancel(jobId) {
			const { podId } = parsePodJobId(jobId);
			await cleanupPod(podId, "cancelled");
		},

		async getStatus(jobId) {
			const { password, podId, requestId } = parsePodJobId(jobId);
			const artifactKey = buildArtifactKey(requestId, workflow);

			const existing = await checkArtifactStat(artifactKey);
			if (existing) {
				await cleanupPod(podId, "artifact-already-in-s3");
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

			const client = buildClient(podId, password);
			if (!(await tryComfyReady(client))) {
				return runningResult(jobId, PROGRESS_PCT_POD_BOOTING);
			}

			const decoded = decodeInputFromPod(
				jobId,
				podId,
				pod.env?.[POD_INPUT_ENV_KEY]
			);
			if (decoded.kind === "result") {
				await cleanupPod(podId, "input-decode-failed");
				return decoded.value;
			}

			const prepareResult = await runPrepareStep(
				jobId,
				podId,
				client,
				decoded.input,
				requestId
			);
			if (prepareResult) {
				return prepareResult;
			}

			const submission = await submitPromptIfNeeded(
				client,
				decoded.input,
				requestId
			);
			if (!submission.submitted || submission.inFlight) {
				return runningResult(jobId, PROGRESS_PCT_PROMPT_QUEUED);
			}

			const history = await client.getHistory();
			const entry = findEntryByClientId(history, requestId);
			if (!entry) {
				return runningResult(jobId, PROGRESS_PCT_PROMPT_RUNNING);
			}
			return await handleHistoryEntry(
				jobId,
				entry,
				client,
				podId,
				requestId,
				artifactKey
			);
		},

		async submit(input): Promise<EngineSubmission> {
			const parsed = workflow.inputSchema.parse(input);
			const requestId = randomRequestId();
			const password = randomPassword();
			const baseEnv = workflow.buildEnv?.(parsed) ?? {};
			const env: Record<string, string> = {
				...baseEnv,
				PASSWORD: password,
				[POD_INPUT_ENV_KEY]: encodeBase64Json(parsed),
			};
			if (civitaiApiKey) {
				env.CIVITAI_TOKEN = civitaiApiKey;
			}
			if (hfToken) {
				env.HF_TOKEN = hfToken;
			}
			if (workflow.pod.timeoutMs) {
				env[POD_TIMEOUT_ENV_KEY] = String(
					Math.ceil(workflow.pod.timeoutMs / 1000)
				);
			}
			const pod = await api.create({
				cloudType: workflow.pod.cloudType,
				containerDiskInGb: workflow.pod.containerDiskInGb,
				env,
				gpuCount: workflow.pod.gpuCount ?? 1,
				gpuTypeIds: workflow.pod.gpuTypeIds,
				imageName: workflow.pod.imageName,
				name: buildPodName(workflow.pod.namePrefix ?? workflow.id, requestId),
				networkVolumeId: workflow.pod.networkVolumeId,
				ports: [`${COMFYUI_PORT}/http`, "22/tcp"],
				supportPublicIp: false,
				templateId: workflow.pod.templateId,
				volumeInGb: workflow.pod.volumeInGb,
				volumeMountPath: "/workspace",
			});
			logger?.info?.("runpod-pod.started", {
				gpuTypeIds: workflow.pod.gpuTypeIds,
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

function buildArtifactKey(
	requestId: string,
	workflow: PodWorkflow<unknown, unknown>
): string {
	const extension = inferExtension(workflow.artifactContentType);
	return `${ARTIFACT_KEY_PREFIX}/${requestId}/output${extension}`;
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

function encodeBase64Json(value: unknown): string {
	const json = JSON.stringify(value);
	return Buffer.from(json, "utf8").toString("base64");
}

function decodeBase64Json(encoded: string): unknown {
	const json = Buffer.from(encoded, "base64").toString("utf8");
	return JSON.parse(json);
}

function pickPrimaryArtifact(
	outputs: ComfyUIHistoryItem["outputs"]
): ComfyUIArtifactRef | null {
	for (const node of Object.values(outputs)) {
		if (node.videos?.length) {
			return node.videos[0] ?? null;
		}
		if (node.gifs?.length) {
			return node.gifs[0] ?? null;
		}
		if (node.images?.length) {
			return node.images[0] ?? null;
		}
	}
	return null;
}

function findEntryByClientId(
	history: Record<string, ComfyUIHistoryItem>,
	clientId: string
): ComfyUIHistoryItem | null {
	for (const item of Object.values(history)) {
		const itemClientId = extractClientId(item.prompt);
		if (itemClientId === clientId) {
			return item;
		}
	}
	return null;
}

function queueContainsClientId(
	queue: ComfyUIQueueResponse,
	clientId: string
): boolean {
	const all = [...queue.queue_running, ...queue.queue_pending];
	return all.some((item) => extractClientId(item) === clientId);
}

function extractClientId(item: ComfyUIQueueItem): string | null {
	const extra = item[3];
	const raw = extra?.client_id;
	return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function stringifyMessages(messages: unknown): string {
	if (!messages) {
		return "no details";
	}
	try {
		return JSON.stringify(messages).slice(0, 500);
	} catch {
		return String(messages).slice(0, 500);
	}
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
