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
import { createRunpodPodInferenceClient } from "@/providers/runpod-pod";

const TRAILING_FILENAME_PATTERN = /[^/]*$/u;

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

function splitCsv(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function readPositiveIntegerEnv(
	value: string | undefined,
	defaultValue: number
): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
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
	storageAdapter?: StorageAdapter;
}

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health", "/api/ready"],
});

function createConfiguredRunpodPodClient(input: {
	civitaiApiKey?: string;
	runpodApiKey?: string;
	s3Config: S3StorageConfig | null;
}) {
	const bootstrapUrl = process.env.RUNPOD_LTX23_POD_BOOTSTRAP_URL;
	if (!(input.runpodApiKey && bootstrapUrl && input.s3Config)) {
		return undefined;
	}
	return createRunpodPodInferenceClient({
		apiKey: input.runpodApiKey,
		civitaiApiKey: input.civitaiApiKey,
		hfToken:
			process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_TOKEN?.trim(),
		restApiBaseUrl: process.env.RUNPOD_REST_API_BASE_URL,
		s3Config: input.s3Config,
		workflows: {
			"ltx-2-3-synth-video": {
				bootstrapUrl,
				cloudType:
					process.env.RUNPOD_LTX23_POD_CLOUD_TYPE === "COMMUNITY"
						? "COMMUNITY"
						: "SECURE",
				containerDiskInGb: readPositiveIntegerEnv(
					process.env.RUNPOD_LTX23_POD_CONTAINER_DISK_GB,
					15
				),
				gpuTypeIds: splitCsv(
					process.env.RUNPOD_LTX23_POD_GPU_TYPE_IDS ??
						"NVIDIA RTX A6000,NVIDIA A40,NVIDIA H100 80GB HBM3"
				),
				imageName:
					process.env.RUNPOD_LTX23_POD_IMAGE_NAME?.trim() ||
					"ls250824/run-comfyui-ltx:28042026",
				namePrefix: "ltx23-synth",
				networkVolumeId: process.env.RUNPOD_LTX23_POD_NETWORK_VOLUME_ID,
				podRunnerUrl: deriveSiblingUrl(bootstrapUrl, "pod_runner.py"),
				templateId: process.env.RUNPOD_LTX23_POD_TEMPLATE_ID ?? "p4f6rm9tb4",
				timeoutMs: readPositiveIntegerEnv(
					process.env.RUNPOD_LTX23_POD_TIMEOUT_MS,
					60 * 60 * 1000
				),
				volumeInGb: readPositiveIntegerEnv(
					process.env.RUNPOD_LTX23_POD_VOLUME_GB,
					90
				),
			},
		},
	});
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
	const runpodApiBaseUrl = process.env.RUNPOD_API_BASE_URL;
	const runpodFooocusEndpointId = process.env.RUNPOD_FOOOCUS_ENDPOINT_ID;
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
	const runpodClient =
		runpodApiKey && runpodFooocusEndpointId
			? createRunpodClient({
					apiBaseUrl: runpodApiBaseUrl,
					apiKey: runpodApiKey,
					endpoints: {
						"fooocus-sdxl": runpodFooocusEndpointId,
					},
				})
			: undefined;
	const runpodPodClient = createConfiguredRunpodPodClient({
		civitaiApiKey,
		runpodApiKey,
		s3Config: resolvedS3Config,
	});

	const inferenceClient =
		options.inferenceClient ??
		(civitaiClient ||
		falClient ||
		replicateClient ||
		runpodClient ||
		runpodPodClient
			? createInferenceRouter({
					civitai: civitaiClient,
					fal: falClient,
					replicate: replicateClient,
					runpod: runpodClient,
					runpodPod: runpodPodClient,
				})
			: createStubInferenceClient());
	const redisUrl =
		options.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
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
