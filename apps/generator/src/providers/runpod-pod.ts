import {
	buildPublicAssetUrl,
	createPresignedPutUrl,
	type S3ObjectStat,
	type S3StorageConfig,
	statS3Object,
} from "@generator/storage";
import { z } from "zod";

import type {
	InferenceClient,
	InferenceJob,
	InferenceSubmission,
} from "./inference";

const RUNPOD_POD_ENDPOINT_ID_PREFIX = "runpod-pod:";
const RUNPOD_POD_JOB_SEPARATOR = ":";
const TRAILING_SLASH = /\/$/u;
const TRAILING_FILENAME_PATTERN = /[^/]*$/u;
const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity/iu;
const OUTPUT_CONTENT_TYPE = "video/mp4";
const LOG_CONTENT_TYPE = "text/plain; charset=utf-8";
const PRESIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

const POD_STATUSES = ["RUNNING", "EXITED", "TERMINATED"] as const;

const RUNPOD_MACHINE_SCHEMA = z
	.object({
		dataCenterId: z.string().nullable().optional(),
		gpuDisplayName: z.string().nullable().optional(),
		gpuTypeId: z.string().nullable().optional(),
		location: z.string().nullable().optional(),
		podHostId: z.string().nullable().optional(),
		secureCloud: z.boolean().optional(),
	})
	.passthrough();

const RUNPOD_POD_SCHEMA = z.object({
	id: z.string().min(1),
	name: z.string().nullable().optional(),
	desiredStatus: z.enum(POD_STATUSES).optional(),
	lastStatusChange: z.string().optional(),
	costPerHr: z.number().optional(),
	gpuCount: z.number().optional(),
	image: z.string().optional(),
	machine: RUNPOD_MACHINE_SCHEMA.nullable().optional(),
});

type RunpodFetch = (input: string, init?: RequestInit) => Promise<Response>;
type RunpodPodSnapshot = z.infer<typeof RUNPOD_POD_SCHEMA>;

interface CreatePodInput {
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	dockerStartCmd?: string[];
	env: Record<string, string>;
	gpuCount?: number;
	gpuTypeIds: string[];
	gpuTypePriority?: "availability" | "custom";
	imageName: string;
	name: string;
	networkVolumeId?: string;
	ports?: string[];
	supportPublicIp?: boolean;
	templateId?: string;
	volumeInGb?: number;
	volumeMountPath?: string;
}

interface RunpodPodClientOptions {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: RunpodFetch;
}

class RunpodPodClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchImpl: RunpodFetch;

	constructor(options: RunpodPodClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = (options.baseUrl ?? "https://rest.runpod.io/v1").replace(
			TRAILING_SLASH,
			""
		);
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	private get authHeaders(): Record<string, string> {
		return {
			authorization: `Bearer ${this.apiKey}`,
			"content-type": "application/json",
		};
	}

	private async postCreatePod(
		payload: CreatePodInput
	): Promise<RunpodPodSnapshot> {
		const response = await this.fetchImpl(`${this.baseUrl}/pods`, {
			body: JSON.stringify(payload),
			headers: this.authHeaders,
			method: "POST",
		});
		await ensureOk(response, "RunPod /pods (create)");
		return RUNPOD_POD_SCHEMA.parse(await response.json());
	}

	async createPod(input: CreatePodInput): Promise<RunpodPodSnapshot> {
		if (input.gpuTypeIds.length === 0) {
			throw new Error("RunPod /pods (create): gpuTypeIds is empty");
		}
		const payload: CreatePodInput = {
			...input,
			gpuTypePriority: input.gpuTypePriority ?? "availability",
		};
		try {
			return await this.postCreatePod(payload);
		} catch (error) {
			if (!isNoCapacityError(error) || payload.gpuTypeIds.length === 1) {
				throw error;
			}
		}

		const errors: string[] = [];
		for (const gpuTypeId of payload.gpuTypeIds) {
			try {
				return await this.postCreatePod({
					...payload,
					gpuTypeIds: [gpuTypeId],
				});
			} catch (error) {
				if (!isNoCapacityError(error)) {
					throw error;
				}
				const message = error instanceof Error ? error.message : String(error);
				errors.push(`${gpuTypeId}: ${message}`);
			}
		}
		throw new Error(
			`RunPod /pods (create) failed for all ${payload.gpuTypeIds.length} gpu types - no capacity:\n  - ${errors.join("\n  - ")}`
		);
	}

	async getPod(podId: string): Promise<RunpodPodSnapshot> {
		const response = await this.fetchImpl(`${this.baseUrl}/pods/${podId}`, {
			headers: this.authHeaders,
		});
		await ensureOk(response, `RunPod /pods/${podId} (get)`);
		return RUNPOD_POD_SCHEMA.parse(await response.json());
	}

	async deletePod(podId: string): Promise<void> {
		try {
			await this.fetchImpl(`${this.baseUrl}/pods/${podId}`, {
				headers: this.authHeaders,
				method: "DELETE",
			});
		} catch {
			// Best-effort cleanup; the execution state is driven by S3 artifact state.
		}
	}
}

export interface RunpodPodWorkflowConfig {
	bootstrapUrl: string;
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	gpuTypeIds: string[];
	imageName: string;
	namePrefix?: string;
	networkVolumeId?: string;
	podRunnerUrl?: string;
	templateId?: string;
	timeoutMs?: number;
	volumeInGb?: number;
}

interface CreateRunpodPodInferenceClientOptions {
	apiKey: string;
	civitaiApiKey?: string;
	createPutUrl?: typeof createPresignedPutUrl;
	fetchImpl?: RunpodFetch;
	hfToken?: string;
	logger?: Pick<Console, "info" | "warn" | "error">;
	restApiBaseUrl?: string;
	s3Config: S3StorageConfig;
	statObject?: typeof statS3Object;
	workflows: Record<string, RunpodPodWorkflowConfig | undefined>;
}

interface ParsedPodJobId {
	podId: string;
	requestId: string;
}

export function formatRunpodPodProviderEndpointId(endpointKey: string): string {
	return `${RUNPOD_POD_ENDPOINT_ID_PREFIX}${endpointKey}`;
}

export function isRunpodPodProviderEndpointId(
	endpointId: string | undefined
): boolean {
	return endpointId?.startsWith(RUNPOD_POD_ENDPOINT_ID_PREFIX) ?? false;
}

export function parseRunpodPodProviderEndpointId(endpointId: string): string {
	if (!isRunpodPodProviderEndpointId(endpointId)) {
		throw new Error("RunPod Pod provider requires a runpod-pod endpointId");
	}
	return endpointId.slice(RUNPOD_POD_ENDPOINT_ID_PREFIX.length);
}

export function formatRunpodPodJobId(input: ParsedPodJobId): string {
	return `${input.podId}${RUNPOD_POD_JOB_SEPARATOR}${input.requestId}`;
}

export function parseRunpodPodJobId(jobId: string): ParsedPodJobId {
	const separatorIndex = jobId.indexOf(RUNPOD_POD_JOB_SEPARATOR);
	if (separatorIndex <= 0 || separatorIndex === jobId.length - 1) {
		throw new Error("RunPod Pod job id must be formatted as podId:requestId");
	}
	return {
		podId: jobId.slice(0, separatorIndex),
		requestId: jobId.slice(separatorIndex + 1),
	};
}

export function createRunpodPodInferenceClient(
	options: CreateRunpodPodInferenceClientOptions
): InferenceClient {
	const podClient = new RunpodPodClient({
		apiKey: options.apiKey,
		baseUrl: options.restApiBaseUrl,
		fetchImpl: options.fetchImpl,
	});
	const createPutUrl = options.createPutUrl ?? createPresignedPutUrl;
	const statObject = options.statObject ?? statS3Object;

	const resolveWorkflow = (endpointKey: unknown) => {
		if (typeof endpointKey !== "string" || endpointKey.length === 0) {
			throw new Error("RunPod Pod provider requires __runpodPod in payload");
		}
		const workflow = options.workflows[endpointKey];
		if (!workflow) {
			throw new Error(`RunPod Pod workflow is not configured: ${endpointKey}`);
		}
		if (workflow.gpuTypeIds.length === 0) {
			throw new Error(`RunPod Pod workflow has no GPU types: ${endpointKey}`);
		}
		return { endpointKey, workflow };
	};

	const checkOutputObject = async (
		key: string
	): Promise<S3ObjectStat | null> => {
		try {
			const stat = await statObject(key, options.s3Config);
			return stat.sizeBytes > 0 ? stat : null;
		} catch {
			return null;
		}
	};

	const cleanupPod = async (podId: string, reason: string) => {
		try {
			await podClient.deletePod(podId);
			options.logger?.info?.("runpod-pod.cleanup", { podId, reason });
		} catch (error) {
			options.logger?.warn?.("runpod-pod.cleanup-failed", {
				message: error instanceof Error ? error.message : "unknown",
				podId,
				reason,
			});
		}
	};

	return {
		async submit(payload): Promise<InferenceSubmission> {
			const { endpointKey, workflow } = resolveWorkflow(payload.__runpodPod);
			const requestId = crypto.randomUUID();
			const outputKey = buildOutputKey(requestId);
			const logKey = buildLogKey(requestId);
			const [outputUploadUrl, logUploadUrl] = await Promise.all([
				createPutUrl(
					{
						contentType: OUTPUT_CONTENT_TYPE,
						expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
						key: outputKey,
					},
					options.s3Config
				),
				createPutUrl(
					{
						contentType: LOG_CONTENT_TYPE,
						expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
						key: logKey,
					},
					options.s3Config
				),
			]);
			const outputPublicUrl = buildPublicAssetUrl(options.s3Config, outputKey);
			const logPublicUrl = buildPublicAssetUrl(options.s3Config, logKey);
			const podEnv = buildPodEnv({
				civitaiApiKey: options.civitaiApiKey,
				hfToken: options.hfToken,
				logPublicUrl,
				logUploadUrl,
				outputPublicUrl,
				outputUploadUrl,
				payload,
				podRunnerUrl:
					workflow.podRunnerUrl ??
					deriveSiblingUrl(workflow.bootstrapUrl, "pod_runner.py"),
				requestId,
				timeoutMs: workflow.timeoutMs,
			});

			const pod = await podClient.createPod({
				cloudType: workflow.cloudType,
				containerDiskInGb: workflow.containerDiskInGb,
				dockerStartCmd: [
					"bash",
					"-lc",
					`curl -sSfL "${workflow.bootstrapUrl}" | bash`,
				],
				env: podEnv,
				gpuCount: 1,
				gpuTypeIds: workflow.gpuTypeIds,
				imageName: workflow.imageName,
				name: buildPodName(workflow.namePrefix ?? endpointKey, requestId),
				networkVolumeId: workflow.networkVolumeId,
				ports: ["22/tcp"],
				supportPublicIp: false,
				templateId: workflow.templateId,
				volumeInGb: workflow.volumeInGb,
				volumeMountPath: "/workspace",
			});

			options.logger?.info?.("runpod-pod.started", {
				endpointKey,
				gpuTypeIds: workflow.gpuTypeIds,
				podId: pod.id,
				requestId,
			});

			return {
				endpointId: formatRunpodPodProviderEndpointId(endpointKey),
				jobId: formatRunpodPodJobId({ podId: pod.id, requestId }),
				queuePosition: null,
				status: "queued",
			};
		},

		async getStatus(jobId, endpointId): Promise<InferenceJob> {
			if (!endpointId) {
				throw new Error("RunPod Pod provider requires endpointId");
			}
			const endpointKey = parseRunpodPodProviderEndpointId(endpointId);
			const { podId, requestId } = parseRunpodPodJobId(jobId);
			const outputKey = buildOutputKey(requestId);
			const outputStat = await checkOutputObject(outputKey);
			const outputPublicUrl = buildPublicAssetUrl(options.s3Config, outputKey);
			const logPublicUrl = buildPublicAssetUrl(
				options.s3Config,
				buildLogKey(requestId)
			);

			if (outputStat) {
				await cleanupPod(podId, "artifact-ready");
				return {
					endpointId,
					errorSummary: null,
					jobId,
					output: {
						logUrl: logPublicUrl,
						podId,
						runpodPodConsoleUrl: buildRunpodPodConsoleUrl(podId),
						videoUrl: outputPublicUrl,
					},
					progressPct: 100,
					queuePosition: null,
					status: "succeeded",
				};
			}

			let pod: RunpodPodSnapshot;
			try {
				pod = await podClient.getPod(podId);
			} catch (error) {
				return {
					endpointId,
					errorSummary:
						error instanceof Error
							? error.message
							: `RunPod pod ${podId} disappeared before uploading output`,
					jobId,
					output: { logUrl: logPublicUrl, podId },
					queuePosition: null,
					status: "failed",
				};
			}

			const desiredStatus = pod.desiredStatus ?? "RUNNING";
			if (desiredStatus === "EXITED" || desiredStatus === "TERMINATED") {
				await cleanupPod(podId, "terminated-without-artifact");
				return {
					endpointId,
					errorSummary: `RunPod pod ${podId} finished without uploading output. Check pod log: ${logPublicUrl}`,
					jobId,
					output: {
						logUrl: logPublicUrl,
						podId,
						runpodPodConsoleUrl: buildRunpodPodConsoleUrl(podId),
					},
					queuePosition: null,
					status: "failed",
				};
			}

			return {
				endpointId,
				errorSummary: null,
				jobId,
				output: {
					endpointKey,
					logUrl: logPublicUrl,
					podId,
					runpodPodConsoleUrl: buildRunpodPodConsoleUrl(podId),
				},
				progressPct: null,
				queuePosition: null,
				status: "running",
			};
		},

		async cancel(jobId): Promise<void> {
			const { podId } = parseRunpodPodJobId(jobId);
			await cleanupPod(podId, "cancelled");
		},
	};
}

async function ensureOk(response: Response, label: string): Promise<void> {
	if (response.ok) {
		return;
	}
	let detail = "";
	try {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			const body = (await response.json()) as Record<string, unknown>;
			detail =
				readString(body.error) ||
				readString(body.message) ||
				readString(body.detail) ||
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

function isNoCapacityError(error: unknown): boolean {
	return error instanceof Error && NO_CAPACITY_PATTERN.test(error.message);
}

function buildOutputKey(requestId: string): string {
	return `generator-artifacts/runpod-pod/${requestId}/output.mp4`;
}

function buildLogKey(requestId: string): string {
	return `generator-artifacts/runpod-pod/${requestId}/pod.log`;
}

function buildRunpodPodConsoleUrl(podId: string): string {
	return `https://runpod.io/console/pods/${podId}`;
}

function buildPodName(prefix: string, requestId: string): string {
	const safePrefix = prefix
		.toLowerCase()
		.replace(/[^a-z0-9-]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 48);
	return `${safePrefix || "runpod-pod"}-${requestId.slice(0, 8)}`;
}

function deriveSiblingUrl(baseUrl: string, siblingFilename: string): string {
	try {
		const url = new URL(baseUrl);
		const segments = url.pathname.split("/");
		segments[segments.length - 1] = siblingFilename;
		url.pathname = segments.join("/");
		return url.toString();
	} catch {
		return baseUrl.replace(TRAILING_FILENAME_PATTERN, siblingFilename);
	}
}

function buildPodEnv(input: {
	civitaiApiKey?: string;
	hfToken?: string;
	logPublicUrl: string;
	logUploadUrl: string;
	outputPublicUrl: string;
	outputUploadUrl: string;
	payload: Record<string, unknown>;
	podRunnerUrl?: string;
	requestId: string;
	timeoutMs?: number;
}): Record<string, string> {
	const payload = input.payload;
	const env: Record<string, string> = {
		CFG_SCALE: readNumberStringWithDefault(payload.cfgScale, "1"),
		CHECKPOINT_NAME: readPayloadStringWithDefault(
			payload,
			"checkpointName",
			"ltx-2.3-22b-dev.safetensors"
		),
		CHECKPOINT_URL: readPayloadStringWithDefault(
			payload,
			"checkpointUrl",
			"https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-dev.safetensors"
		),
		DISTILLED_LORA_NAME: readPayloadStringWithDefault(
			payload,
			"distilledLoraName",
			"ltxv/ltx2/ltx-2.3-22b-distilled-lora-384-1.1.safetensors"
		),
		DISTILLED_LORA_SCALE: readNumberStringWithDefault(
			payload.distilledLoraScale,
			"0.6"
		),
		DISTILLED_LORA_URL: readPayloadStringWithDefault(
			payload,
			"distilledLoraUrl",
			"https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-distilled-lora-384-1.1.safetensors"
		),
		FPS: readNumberStringWithDefault(payload.fps, "24"),
		HEIGHT: readNumberStringWithDefault(payload.height, "1280"),
		LOG_PUBLIC_URL: input.logPublicUrl,
		LOG_UPLOAD_URL: input.logUploadUrl,
		LORA_NAME: readPayloadStringWithDefault(
			payload,
			"loraName",
			"ltxv/ltx2/custom-lora.safetensors"
		),
		LORA_SCALE: readNumberStringWithDefault(payload.loraScale, "1"),
		LORA_URL: readPayloadStringWithDefault(payload, "loraUrl", ""),
		NEGATIVE_PROMPT: readPayloadStringWithDefault(
			payload,
			"negativePrompt",
			""
		),
		NUM_FRAMES: readNumberStringWithDefault(payload.numFrames, "241"),
		OUTPUT_CONTENT_TYPE,
		OUTPUT_PUBLIC_URL: input.outputPublicUrl,
		OUTPUT_UPLOAD_URL: input.outputUploadUrl,
		PROMPT: readPayloadStringWithDefault(payload, "prompt", ""),
		RUNPOD_JOB_ID: input.requestId,
		STEPS: readNumberStringWithDefault(payload.steps, "8"),
		TEXT_ENCODER_NAME: readPayloadStringWithDefault(
			payload,
			"textEncoderName",
			"gemma_3_12B_it_fp4_mixed.safetensors"
		),
		TEXT_ENCODER_URL: readPayloadStringWithDefault(
			payload,
			"textEncoderUrl",
			"https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors"
		),
		WIDTH: readNumberStringWithDefault(payload.width, "896"),
		WORKFLOW_URL: readPayloadStringWithDefault(
			payload,
			"workflowUrl",
			"https://raw.githubusercontent.com/Lightricks/ComfyUI-LTXVideo/master/example_workflows/2.3/LTX-2.3_T2V_I2V_Single_Stage_Distilled_Full.json"
		),
	};

	const seed = readNumberString(payload.seed);
	if (seed) {
		env.SEED = seed;
	}
	const inputImageUrl = readPayloadString(payload, "inputImageUrl");
	if (inputImageUrl) {
		env.INPUT_IMAGE_URL = inputImageUrl;
	}
	if (input.podRunnerUrl) {
		env.POD_RUNNER_URL = input.podRunnerUrl;
	}
	if (input.hfToken) {
		env.HF_TOKEN = input.hfToken;
	}
	if (input.civitaiApiKey) {
		env.CIVITAI_API_KEY = input.civitaiApiKey;
	}
	if (input.timeoutMs) {
		env.RUNPOD_POD_TIMEOUT_SECONDS = String(Math.ceil(input.timeoutMs / 1000));
	}

	return env;
}

function readPayloadString(
	payload: Record<string, unknown>,
	key: string
): string | undefined {
	const value = payload[key];
	return readString(value)?.trim() || undefined;
}

function readPayloadStringWithDefault(
	payload: Record<string, unknown>,
	key: string,
	defaultValue: string
): string {
	return readPayloadString(payload, key) ?? defaultValue;
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberString(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim();
	}
	return;
}

function readNumberStringWithDefault(
	value: unknown,
	defaultValue: string
): string {
	return readNumberString(value) ?? defaultValue;
}
