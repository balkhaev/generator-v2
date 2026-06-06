import type { AuthVariables } from "@generator/auth/middleware";
import { createSessionMiddleware } from "@generator/auth/middleware";
import { createPublicPathMatcher } from "@generator/auth/public-paths";
import { pingDatabase } from "@generator/db/health";
import type { EventPublisher } from "@generator/events";
import {
	DEBUG_CORRELATION_HEADER,
	GENERATOR_INTERNAL_TOKEN_HEADER,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import { createRedisConnection } from "@generator/queue";
import {
	type ActivePodRegistry,
	type AnyWorkflowDefinition,
	createFluxDevDetailerServerlessWorkflow,
	createFluxDevImageServerlessWorkflow,
	createFooocusSdxlWorkflow,
	createLtx23VideoWorkflow,
	createRunpodService,
	createWanVideoServerlessWorkflow,
	type PodInputStore,
	type RunpodService,
	type StickyVolumeStore,
	type WarmPodPool,
} from "@generator/runpod";
import {
	type S3StorageConfig,
	tryResolveS3StorageConfig,
} from "@generator/storage";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
	type ExecutionRepository,
	ExecutionService,
} from "@/domain/executions";
import { createCivitaiClient } from "@/providers/civitai";
import { createFalClient } from "@/providers/fal";
import type { InferenceClient } from "@/providers/inference";
import { createInferenceRouter } from "@/providers/inference-router";
import { createReplicateClient } from "@/providers/replicate";
import { createRunpodClient } from "@/providers/runpod";
import {
	createRedisActivePodRegistry,
	createRedisPodInputStore,
	createRedisStickyVolumeStore,
	createRedisWarmPodPool,
} from "@/providers/runpod-warm-pool";
import {
	buildStaticPodWorkflows,
	resolveComfyPodBaseUrl,
	resolveStaticPodOverridesFromEnv,
} from "@/providers/static-pod-workflows";

function createStubInferenceClient(): InferenceClient {
	const fail = (): never => {
		throw new Error("No inference provider configured");
	};
	return {
		cancel: () => fail(),
		getStatus: () => fail(),
		submit: () => fail(),
	};
}

function readPositiveIntegerEnv(
	value: string | undefined,
	defaultValue: number
): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function readNonNegativeIntegerEnv(
	value: string | undefined,
	defaultValue: number
): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultValue;
}

interface Ltx23VolumeEnvEntry {
	gpus: string[];
	id: string;
	label?: string;
}

function parseLtx23NetworkVolumesEnv(raw: string | undefined): Array<{
	gpuTypeIds: string[];
	label?: string;
	networkVolumeId: string;
}> {
	if (!raw?.trim()) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(
			"RUNPOD_LTX23_POD_NETWORK_VOLUMES must be a JSON array of {id,gpus[,label]} objects"
		);
	}
	if (!Array.isArray(parsed)) {
		throw new Error("RUNPOD_LTX23_POD_NETWORK_VOLUMES must be a JSON array");
	}
	return parsed.map((entry, index) => {
		const candidate = entry as Partial<Ltx23VolumeEnvEntry>;
		if (
			typeof candidate.id !== "string" ||
			!Array.isArray(candidate.gpus) ||
			candidate.gpus.length === 0
		) {
			throw new Error(
				`RUNPOD_LTX23_POD_NETWORK_VOLUMES[${index}] must have a non-empty id and gpus[]`
			);
		}
		return {
			gpuTypeIds: candidate.gpus,
			label: candidate.label,
			networkVolumeId: candidate.id,
		};
	});
}

import {
	createProviderArtifactDownloadOptions,
	createStorageAdapter,
	type StorageAdapter,
} from "@/providers/storage";
import {
	createGeneratorExecutionQueueClient,
	type GeneratorExecutionQueue,
} from "@/queue/executions";
import { createDrizzleExecutionRepository } from "@/repositories/executions";
import { createExecutionRoutes } from "@/routes/executions";
import { createWorkflowRoutes } from "@/routes/workflows";

interface AppOptions {
	corsOrigin?: string | string[];
	eventPublisher?: EventPublisher | null;
	executionQueue?: GeneratorExecutionQueue;
	executionRepository?: ExecutionRepository;
	getSession?: (
		request: Request
	) => Promise<{ session: unknown; user: unknown } | null>;
	inferenceClient?: InferenceClient;
	loggerImpl?: Pick<Console, "info" | "error" | "warn">;
	redisUrl?: string;
	/**
	 * Готовый список RunPod workflows, загруженный из БД (admin-managed
	 * pod templates). Если массив непустой — используется вместо env-defaults.
	 * Если undefined или пустой — `createConfiguredRunpodService` собирает
	 * workflows из env-переменных (backward compat для deploy без сидов БД).
	 */
	runpodWorkflows?: AnyWorkflowDefinition[];
	storageAdapter?: StorageAdapter;
}

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health", "/api/ready"],
});

/**
 * Единый персистентный ComfyUI-под (static pod). Если сконфигурирован —
 * возвращает LTX/WAN/Flux workflows, иначе null (fallback на serverless/pod).
 */
function tryBuildStaticPodEnvWorkflows(): AnyWorkflowDefinition[] | null {
	const comfyPodBaseUrl = resolveComfyPodBaseUrl({
		baseUrl: process.env.RUNPOD_COMFYUI_BASE_URL,
		podId: process.env.RUNPOD_COMFYUI_POD_ID,
	});
	if (!comfyPodBaseUrl) {
		return null;
	}
	return buildStaticPodWorkflows(
		comfyPodBaseUrl,
		resolveStaticPodOverridesFromEnv()
	);
}

function pushWanFluxServerlessWorkflows(workflows: AnyWorkflowDefinition[]) {
	const wanEndpointId = process.env.RUNPOD_WAN22_SERVERLESS_ENDPOINT_ID?.trim();
	if (wanEndpointId) {
		workflows.push(
			createWanVideoServerlessWorkflow({
				accelLoraHighFilename:
					process.env.RUNPOD_WAN22_ACCEL_LORA_HIGH?.trim() || undefined,
				accelLoraLowFilename:
					process.env.RUNPOD_WAN22_ACCEL_LORA_LOW?.trim() || undefined,
				enableWarmup: process.env.RUNPOD_WAN22_ENABLE_WARMUP !== "false",
				endpointId: wanEndpointId,
				highNoiseModelFilename:
					process.env.RUNPOD_WAN22_HIGH_NOISE_MODEL?.trim() || undefined,
				lowNoiseModelFilename:
					process.env.RUNPOD_WAN22_LOW_NOISE_MODEL?.trim() || undefined,
				textEncoderFilename:
					process.env.RUNPOD_WAN22_TEXT_ENCODER?.trim() || undefined,
				vaeFilename: process.env.RUNPOD_WAN22_VAE?.trim() || undefined,
				webhookUrl: process.env.RUNPOD_WAN22_WEBHOOK_URL?.trim() || undefined,
			})
		);
	}
	const fluxEndpointId =
		process.env.RUNPOD_FLUX_DEV_SERVERLESS_ENDPOINT_ID?.trim();
	if (fluxEndpointId) {
		workflows.push(
			createFluxDevImageServerlessWorkflow({
				checkpointFilename:
					process.env.RUNPOD_FLUX_DEV_CHECKPOINT?.trim() || undefined,
				enableWarmup: process.env.RUNPOD_FLUX_DEV_ENABLE_WARMUP === "true",
				endpointId: fluxEndpointId,
				webhookUrl:
					process.env.RUNPOD_FLUX_DEV_WEBHOOK_URL?.trim() || undefined,
			})
		);
		// Детейлер переиспользует тот же flux serverless endpoint (та же модель
		// на volume), отличается только графом (img2img upscale+detail).
		workflows.push(
			createFluxDevDetailerServerlessWorkflow({
				checkpointFilename:
					process.env.RUNPOD_FLUX_DEV_CHECKPOINT?.trim() || undefined,
				endpointId: fluxEndpointId,
				webhookUrl:
					process.env.RUNPOD_FLUX_DEV_WEBHOOK_URL?.trim() || undefined,
			})
		);
	}
}

function pushLtxDisposablePodWorkflow(workflows: AnyWorkflowDefinition[]) {
	const ltxTemplateId =
		process.env.RUNPOD_LTX23_POD_TEMPLATE_ID?.trim() || "p4f6rm9tb4";
	const ltxNetworkVolumes = parseLtx23NetworkVolumesEnv(
		process.env.RUNPOD_LTX23_POD_NETWORK_VOLUMES
	);
	if (!(ltxTemplateId && ltxNetworkVolumes.length > 0)) {
		return;
	}
	workflows.push(
		createLtx23VideoWorkflow({
			pod: {
				cloudType:
					process.env.RUNPOD_LTX23_POD_CLOUD_TYPE === "COMMUNITY"
						? "COMMUNITY"
						: "SECURE",
				containerDiskInGb: readPositiveIntegerEnv(
					process.env.RUNPOD_LTX23_POD_CONTAINER_DISK_GB,
					15
				),
				imageName:
					process.env.RUNPOD_LTX23_POD_IMAGE_NAME?.trim() ||
					"ls250824/run-comfyui-ltx:28042026",
				keepAliveMs: readNonNegativeIntegerEnv(
					process.env.RUNPOD_LTX23_POD_KEEP_ALIVE_MS,
					10 * 60 * 1000
				),
				namePrefix: "ltx23",
				networkVolumes: ltxNetworkVolumes,
				templateId: ltxTemplateId,
				timeoutMs: readPositiveIntegerEnv(
					process.env.RUNPOD_LTX23_POD_TIMEOUT_MS,
					60 * 60 * 1000
				),
				volumeInGb: readPositiveIntegerEnv(
					process.env.RUNPOD_LTX23_POD_VOLUME_GB,
					90
				),
			},
		})
	);
}

function buildEnvDefaultWorkflows(): AnyWorkflowDefinition[] {
	const workflows: AnyWorkflowDefinition[] = [];
	const fooocusEndpointId = process.env.RUNPOD_FOOOCUS_ENDPOINT_ID;
	if (fooocusEndpointId) {
		workflows.push(
			createFooocusSdxlWorkflow({
				endpointId: fooocusEndpointId,
				enableWarmup:
					process.env.RUNPOD_FOOOCUS_ENABLE_WARMUP?.toLowerCase() === "true",
				webhookUrl: process.env.RUNPOD_FOOOCUS_WEBHOOK_URL?.trim() || undefined,
			})
		);
	}
	// Static pod имеет приоритет над serverless/disposable-pod для LTX/WAN/Flux.
	const staticPodWorkflows = tryBuildStaticPodEnvWorkflows();
	if (staticPodWorkflows) {
		workflows.push(...staticPodWorkflows);
		return workflows;
	}
	pushWanFluxServerlessWorkflows(workflows);
	pushLtxDisposablePodWorkflow(workflows);
	return workflows;
}

function createConfiguredRunpodService(input: {
	activeRegistry?: ActivePodRegistry;
	civitaiApiKey?: string;
	inputStore?: PodInputStore;
	prebuiltWorkflows?: AnyWorkflowDefinition[];
	runpodApiKey?: string;
	s3Config: S3StorageConfig | null;
	stickyStore?: StickyVolumeStore;
	warmPool?: WarmPodPool;
}): RunpodService | null {
	if (!(input.runpodApiKey && input.s3Config)) {
		return null;
	}
	const workflows =
		input.prebuiltWorkflows && input.prebuiltWorkflows.length > 0
			? input.prebuiltWorkflows
			: buildEnvDefaultWorkflows();
	if (workflows.length === 0) {
		return null;
	}
	return createRunpodService({
		activeRegistry: input.activeRegistry,
		apiKey: input.runpodApiKey,
		civitaiApiKey: input.civitaiApiKey,
		hfToken:
			process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_TOKEN?.trim(),
		inputStore: input.inputStore,
		podsBaseUrl: process.env.RUNPOD_REST_API_BASE_URL,
		s3: input.s3Config,
		serverlessBaseUrl: process.env.RUNPOD_API_BASE_URL,
		stickyStore: input.stickyStore,
		warmPool: input.warmPool,
		workflows,
	});
}

/**
 * Wires the production RunPod client (with Redis-backed warm pool + input
 * store) — kept as a helper so `createApp` itself stays under Biome's
 * cognitive-complexity budget.
 */
function buildRunpodClientForApp(input: {
	civitaiApiKey?: string;
	hasInferenceOverride: boolean;
	prebuiltWorkflows?: AnyWorkflowDefinition[];
	redisUrl: string;
	runpodApiKey?: string;
	s3Config: S3StorageConfig | null;
}): ReturnType<typeof createRunpodClient> | undefined {
	if (input.hasInferenceOverride || !(input.runpodApiKey && input.s3Config)) {
		return;
	}
	const redis = createRedisConnection(input.redisUrl);
	const service = createConfiguredRunpodService({
		activeRegistry: createRedisActivePodRegistry(redis),
		civitaiApiKey: input.civitaiApiKey,
		inputStore: createRedisPodInputStore(redis),
		prebuiltWorkflows: input.prebuiltWorkflows,
		runpodApiKey: input.runpodApiKey,
		s3Config: input.s3Config,
		stickyStore: createRedisStickyVolumeStore(redis),
		warmPool: createRedisWarmPodPool(redis),
	});
	if (!service) {
		return;
	}
	return createRunpodClient(service);
}

export function createApp(options: AppOptions) {
	// Читаем переменные напрямую из process.env: тесты мутируют их в рантайме,
	// а централизованный `env` из @generator/env/server валидируется при импорте
	// и кэшируется при первом доступе. Централизация сохраняется на уровне
	// входных точек (index.ts/worker.ts); здесь нужен доступ без валидации.
	const internalToken = process.env.GENERATOR_INTERNAL_TOKEN?.trim();
	const civitaiApiKey =
		process.env.CIVITAI_API_KEY?.trim() ||
		process.env.CIVITAI_API_TOKEN?.trim();
	const civitaiApiBaseUrl = process.env.CIVITAI_API_BASE_URL;
	const falKey = process.env.FAL_KEY;
	const replicateApiToken = process.env.REPLICATE_API_TOKEN;
	const replicateApiBaseUrl = process.env.REPLICATE_API_BASE_URL;
	const runpodApiKey = process.env.RUNPOD_API_KEY;
	const resolvedS3Config = tryResolveS3StorageConfig();
	const storageAdapter =
		options.storageAdapter ??
		(() => {
			const config = resolvedS3Config;
			if (!config) {
				throw new Error(
					"S3 storage is required for the generator service. Set S3_BUCKET, S3_ENDPOINT, " +
						"S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and S3_PUBLIC_BASE_URL when not derivable)."
				);
			}
			return createStorageAdapter({
				config,
				downloadOptions: createProviderArtifactDownloadOptions({
					replicateApiToken,
				}),
				logger: options.loggerImpl,
			});
		})();

	const civitaiClient = civitaiApiKey
		? createCivitaiClient({
				apiBaseUrl: civitaiApiBaseUrl,
				apiKey: civitaiApiKey,
			})
		: undefined;
	const falClient = falKey ? createFalClient({ apiKey: falKey }) : undefined;
	const replicateClient = replicateApiToken
		? createReplicateClient({
				apiBaseUrl: replicateApiBaseUrl,
				apiToken: replicateApiToken,
			})
		: undefined;
	const redisUrl =
		options.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
	const runpodClient = buildRunpodClientForApp({
		civitaiApiKey,
		hasInferenceOverride: Boolean(options.inferenceClient),
		prebuiltWorkflows: options.runpodWorkflows,
		redisUrl,
		runpodApiKey,
		s3Config: resolvedS3Config,
	});

	const inferenceClient =
		options.inferenceClient ??
		(civitaiClient || falClient || replicateClient || runpodClient
			? createInferenceRouter({
					civitai: civitaiClient,
					fal: falClient,
					replicate: replicateClient,
					runpod: runpodClient,
				})
			: createStubInferenceClient());
	const executionService = new ExecutionService(
		options.executionRepository ?? createDrizzleExecutionRepository(),
		options.executionQueue ?? createGeneratorExecutionQueueClient(redisUrl),
		inferenceClient,
		storageAdapter,
		options.loggerImpl,
		options.eventPublisher ?? null
	);

	const app = new Hono<{
		Variables: AuthVariables & {
			debugCorrelationId: string;
		};
	}>();

	app.use(logger());
	app.use(async (c, next) => {
		const debugCorrelationId = resolveDebugCorrelationId({
			headers: c.req.raw.headers,
		});
		c.set("debugCorrelationId", debugCorrelationId);
		await next();
		c.header(DEBUG_CORRELATION_HEADER, debugCorrelationId);
	});
	if (options.corsOrigin) {
		app.use(
			"/*",
			cors({
				origin: options.corsOrigin,
				allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
				allowHeaders: [
					"Content-Type",
					"Authorization",
					DEBUG_CORRELATION_HEADER,
				],
				credentials: true,
			})
		);
	}
	if (options.getSession) {
		app.use(
			"/api/*",
			createSessionMiddleware({
				getSession: options.getSession,
				isAuthorizedRequest: (request) =>
					Boolean(
						internalToken &&
							request.headers.get(GENERATOR_INTERNAL_TOKEN_HEADER) ===
								internalToken
					),
				isPublicPath: isPublicApiPath,
			})
		);
	}

	app.get("/", (c) => c.text("OK"));
	// Liveness: только подтверждает что процесс жив. БД и провайдеры не трогает.
	app.get("/api/health", (c) =>
		c.json({
			ok: true,
			service: "generator",
		})
	);
	// Readiness: пинг БД + проверка что workflows загружены.
	app.get("/api/ready", async (c) => {
		try {
			await pingDatabase();
			return c.json({
				ok: true,
				workflows: executionService.listWorkflows().length,
			});
		} catch (error) {
			options.loggerImpl?.warn?.("generator.ready.failed", error);
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "database unreachable",
					ok: false,
				},
				503
			);
		}
	});

	app.route("/api/workflows", createWorkflowRoutes(executionService));
	app.route("/api/executions", createExecutionRoutes(executionService));

	app.onError((error, c) => {
		c.header(DEBUG_CORRELATION_HEADER, c.get("debugCorrelationId"));
		options.loggerImpl?.error("generator.error", error);
		return c.json({ error: error.message }, 500);
	});

	return app;
}
