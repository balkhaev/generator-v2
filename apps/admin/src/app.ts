import type { AuthVariables } from "@generator/auth/middleware";
import {
	createAuthHandler,
	createSessionMiddleware,
} from "@generator/auth/middleware";
import { createPublicPathMatcher } from "@generator/auth/public-paths";
import type {
	AdminDashboardSnapshot,
	AdminSetupStatus,
	PromptEnhanceTarget,
} from "@generator/contracts/admin";
import type { StudioRunDebugBundle } from "@generator/contracts/studio";
import { pingDatabase } from "@generator/db/health";
import { getGeneratorCallbackToken } from "@generator/env/server";
import { type FetchLike, proxyHttpRequest } from "@generator/http/proxy";
import {
	DEBUG_CORRELATION_HEADER,
	GENERATOR_CALLBACK_TOKEN_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import type { S3StorageConfig } from "@generator/storage";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { DatasetBuilderSettings } from "@/domain/dataset-builder-settings";
import type { LoraRegistryService } from "@/domain/loras";
import type { PersonLoraTrainingControl } from "@/domain/person-lora-training-control";
import type { PromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import type { RunpodAdminService } from "@/domain/runpod-admin";
import type { RunpodRegistryReloadBus } from "@/domain/runpod-registry-reload-bus";
import type { TrainingProviderSettings } from "@/domain/training-provider-settings";
import type { UsersService } from "@/domain/users";
import type { WorkerSettingsReader } from "@/domain/worker-settings-store";
import type { ScenarioRunpodBindingRepository } from "@/repositories/scenario-runpod-binding";
import {
	type AdminSettingsEnvResolver,
	createAdminSettingsRoutes,
} from "@/routes/admin-settings";
import { createDatasetBuilderRoutes } from "@/routes/dataset-builder";
import { createInternalRoutes } from "@/routes/internal";
import { createAdminLoraRoutes } from "@/routes/loras";
import { createOpenRouterModelsRoutes } from "@/routes/openrouter-models";
import { createPromptEnhanceProviderRoutes } from "@/routes/prompt-enhance-provider";
import { createRunpodAdminRoutes } from "@/routes/runpod-admin";
import {
	createRuntimeConfigAdminRoutes,
	createRuntimeConfigInternalRoutes,
	type RuntimeConfigRoutesDeps,
} from "@/routes/runtime-config";
import { createScenarioRunpodBindingRoutes } from "@/routes/scenario-runpod-binding";
import { createStorageRoutes } from "@/routes/storage";
import {
	createTrainingProviderRoutes,
	type TrainingProviderAvailabilityResolver,
} from "@/routes/training-provider";
import { createAdminUserRoutes } from "@/routes/users";
import { createWorkflowAdminRoutes } from "@/routes/workflows";

interface AppVariables extends AuthVariables {
	debugCorrelationId: string;
}

interface AppOptions {
	adminSettingsEnvResolver?: AdminSettingsEnvResolver;
	authHandler: (request: Request) => Response | Promise<Response>;
	corsOrigins: string[];
	datasetBuilderSettings?: DatasetBuilderSettings;
	fetchImpl?: FetchLike;
	generatorBaseUrl: string;
	getSession: (
		request: Request
	) => Promise<{ session: unknown; user: unknown } | null>;
	internalControlToken?: string;
	internalTrainingControlService?: PersonLoraTrainingControl;
	loadDashboardSnapshot: () => Promise<AdminDashboardSnapshot>;
	loadSetupStatus: () => Promise<AdminSetupStatus>;
	loggerImpl?: Pick<Console, "info" | "error">;
	loraRegistryService?: LoraRegistryService;
	/** Опционально — для заголовка Authorization при запросе каталога моделей OpenRouter. */
	openRouterModelsApiKey?: string | null;
	promptEnhanceEnvByTarget?: Record<
		PromptEnhanceTarget,
		{
			grokConfigured: boolean;
			openRouterConfigured: boolean;
			openRouterModelEnvDefault: string;
		}
	>;
	promptEnhanceSettings?: PromptEnhanceSettings;
	runpodAdminService?: RunpodAdminService;
	/**
	 * Optional. Когда задан — после успешных mutation по scenario-binding'у
	 * админка публикует reload event, и generator-api/worker делают
	 * graceful self-restart. RunpodAdminService получает тот же bus
	 * напрямую (см. index.ts), отдельный проброс там не нужен.
	 */
	runpodRegistryReloadBus?: RunpodRegistryReloadBus;
	runtimeConfig?: {
		deps: RuntimeConfigRoutesDeps;
		/** Token shared with consumer services for /api/internal/runtime-config. */
		internalToken?: string;
	};
	s3Config?: S3StorageConfig;
	scenarioRunpodBindingRepository?: ScenarioRunpodBindingRepository;
	studioBaseUrl: string;
	trainingProviderAvailability?: TrainingProviderAvailabilityResolver;
	trainingProviderSettings?: TrainingProviderSettings;
	usersService?: UsersService;
	workerSettingsReader?: WorkerSettingsReader;
}

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health", "/api/ready", "/api/setup/status"],
	prefixes: ["/api/auth/", "/api/internal/"],
});

const BEARER_PREFIX_PATTERN = /^Bearer\s+/iu;

/**
 * Mounts the cluster of routes that all hang off `trainingProviderSettings`:
 * the provider-toggle endpoints, the prompt-enhance per-target endpoints,
 * and the read-only admin settings snapshot used by the UI. Pulled out of
 * `createApp` to keep its cognitive complexity under the lint budget — the
 * dependencies between these routes (snapshot needs both training and
 * prompt-enhance) make a flat conditional cascade hard to read.
 */
function registerTrainingAndSettingsRoutes(
	app: Hono<{ Variables: AppVariables }>,
	options: AppOptions
) {
	if (
		!(options.trainingProviderSettings && options.trainingProviderAvailability)
	) {
		return;
	}

	app.route(
		"/api/admin/training-provider",
		createTrainingProviderRoutes({
			availability: options.trainingProviderAvailability,
			settings: options.trainingProviderSettings,
			workerSettingsReader: options.workerSettingsReader,
		})
	);

	if (options.promptEnhanceSettings && options.promptEnhanceEnvByTarget) {
		app.route(
			"/api/admin/prompt-enhance-provider",
			createPromptEnhanceProviderRoutes({
				envByTarget: options.promptEnhanceEnvByTarget,
				settings: options.promptEnhanceSettings,
			})
		);
	}

	if (options.adminSettingsEnvResolver) {
		app.route(
			"/api/admin/settings",
			createAdminSettingsRoutes({
				availability: options.trainingProviderAvailability,
				...(options.datasetBuilderSettings
					? { datasetBuilderSettings: options.datasetBuilderSettings }
					: {}),
				envResolver: options.adminSettingsEnvResolver,
				...(options.promptEnhanceSettings && options.promptEnhanceEnvByTarget
					? {
							promptEnhanceEnvByTarget: options.promptEnhanceEnvByTarget,
							promptEnhanceSettings: options.promptEnhanceSettings,
						}
					: {}),
				settings: options.trainingProviderSettings,
				workerSettingsReader: options.workerSettingsReader,
			})
		);
	}
}

function createBearerTokenAuthorizer(token: string | undefined) {
	if (!token) {
		return undefined;
	}
	return (request: Request) => {
		const header = request.headers.get("authorization");
		if (!header) {
			return false;
		}
		return header.replace(BEARER_PREFIX_PATTERN, "") === token;
	};
}

export function createApp(options: AppOptions) {
	const app = new Hono<{ Variables: AppVariables }>();
	const fetchImpl = options.fetchImpl ?? fetch;

	app.use(logger());
	app.use(
		"/api/*",
		cors({
			origin: options.corsOrigins,
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", DEBUG_CORRELATION_HEADER],
			credentials: true,
		})
	);
	app.use(async (c, next) => {
		const debugCorrelationId = resolveDebugCorrelationId({
			headers: c.req.raw.headers,
		});
		c.set("debugCorrelationId", debugCorrelationId);
		await next();
		c.header(DEBUG_CORRELATION_HEADER, debugCorrelationId);
	});

	app.use(
		"/api/*",
		createSessionMiddleware({
			getSession: options.getSession,
			isAuthorizedRequest: createBearerTokenAuthorizer(
				options.internalControlToken
			),
			isPublicPath: isPublicApiPath,
		})
	);

	app.route(
		"/api/admin/openrouter-models",
		createOpenRouterModelsRoutes({
			fetchImpl,
			openRouterApiKey: options.openRouterModelsApiKey,
		})
	);

	app.on(
		["GET", "POST"],
		"/api/auth/*",
		createAuthHandler(options.authHandler)
	);

	app.get("/", (c) => c.text("OK"));
	// Liveness: только подтверждает что процесс жив. БД не трогает.
	app.get("/api/health", (c) =>
		c.json({
			gateway: true,
			ok: true,
			service: "admin",
		})
	);
	// Readiness: лёгкий пинг БД (`select 1`).
	app.get("/api/ready", async (c) => {
		try {
			await pingDatabase();
			return c.json({ ok: true });
		} catch (error) {
			options.loggerImpl?.error?.("admin.ready.failed", error);
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
	app.get("/api/setup/status", async (c) =>
		c.json(await options.loadSetupStatus())
	);
	app.get("/api/dashboard", async (c) =>
		c.json(await options.loadDashboardSnapshot())
	);

	app.get("/api/dashboard/runs/:studioRunId/debug", async (c) => {
		const studioRunId = c.req.param("studioRunId");
		const normalizedStudio = normalizeBaseUrl(options.studioBaseUrl);
		const upstream = await fetchImpl(
			`${normalizedStudio}/api/internal/runs/${encodeURIComponent(studioRunId)}`,
			{
				headers: {
					[GENERATOR_CALLBACK_TOKEN_HEADER]: getGeneratorCallbackToken(),
				},
			}
		);
		if (upstream.status === 404) {
			return c.json({ error: "Run not found" }, 404);
		}
		if (!upstream.ok) {
			const text = await upstream.text();
			return c.json({ error: text || `Upstream ${upstream.status}` }, 502);
		}
		const json = (await upstream.json()) as StudioRunDebugBundle;
		return c.json(json);
	});

	if (options.internalTrainingControlService) {
		app.route(
			"/api/internal",
			createInternalRoutes(
				options.internalTrainingControlService,
				options.s3Config,
				options.loraRegistryService
			)
		);
	}

	if (options.runtimeConfig) {
		app.route(
			"/api/admin/integrations",
			createRuntimeConfigAdminRoutes(options.runtimeConfig.deps)
		);
		if (options.runtimeConfig.internalToken) {
			app.route(
				"/api/internal/runtime-config",
				createRuntimeConfigInternalRoutes({
					store: options.runtimeConfig.deps.store,
					token: options.runtimeConfig.internalToken,
				})
			);
		}
	}

	if (options.loraRegistryService) {
		app.route(
			"/api/admin/loras",
			createAdminLoraRoutes(options.loraRegistryService)
		);
	}

	if (options.runpodAdminService) {
		app.route(
			"/api/admin/runpod",
			createRunpodAdminRoutes(options.runpodAdminService)
		);
	}

	if (options.scenarioRunpodBindingRepository) {
		app.route(
			"/api/admin/scenarios/runpod-binding",
			createScenarioRunpodBindingRoutes({
				reloadBus: options.runpodRegistryReloadBus,
				repository: options.scenarioRunpodBindingRepository,
			})
		);
	}

	app.route(
		"/api/admin/storage",
		createStorageRoutes({ s3Config: options.s3Config })
	);

	if (options.usersService) {
		app.route("/api/admin/users", createAdminUserRoutes(options.usersService));
	}

	app.route(
		"/api/admin/workflows",
		createWorkflowAdminRoutes(options.runtimeConfig?.deps)
	);

	registerTrainingAndSettingsRoutes(app, options);

	if (options.datasetBuilderSettings) {
		app.route(
			"/api/admin/dataset-builder",
			createDatasetBuilderRoutes({
				settings: options.datasetBuilderSettings,
			})
		);
	}

	const studioProxyRoutes = [
		"/api/workflows",
		"/api/workflows/*",
		"/api/scenarios",
		"/api/scenarios/*",
		"/api/runs",
		"/api/runs/*",
	];
	for (const route of studioProxyRoutes) {
		app.all(route, (c) =>
			proxyHttpRequest({
				debugCorrelationId: c.get("debugCorrelationId"),
				fetchImpl,
				request: c.req.raw,
				targetBaseUrl: options.studioBaseUrl,
			})
		);
	}

	app.onError((error, c) => {
		c.header(DEBUG_CORRELATION_HEADER, c.get("debugCorrelationId"));
		options.loggerImpl?.error("admin.error", error);
		return c.json({ error: error.message }, 500);
	});

	return app;
}
