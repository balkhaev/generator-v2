import type { AuthVariables } from "@generator/auth/middleware";
import {
	createAuthHandler,
	createSessionMiddleware,
} from "@generator/auth/middleware";
import { createPublicPathMatcher } from "@generator/auth/public-paths";
import type {
	AdminDashboardSnapshot,
	AdminSetupStatus,
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
import type { LoraRegistryService } from "@/domain/loras";
import type { PersonLoraTrainingControl } from "@/domain/person-lora-training-control";
import type { PromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import type { TrainingProviderSettings } from "@/domain/training-provider-settings";
import type { UsersService } from "@/domain/users";
import type { WorkerSettingsReader } from "@/domain/worker-settings-store";
import {
	type AdminSettingsEnvResolver,
	createAdminSettingsRoutes,
} from "@/routes/admin-settings";
import { createInternalRoutes } from "@/routes/internal";
import { createAdminLoraRoutes } from "@/routes/loras";
import { createPromptEnhanceProviderRoutes } from "@/routes/prompt-enhance-provider";
import {
	createTrainingProviderRoutes,
	type TrainingProviderAvailabilityResolver,
} from "@/routes/training-provider";
import { createAdminUserRoutes } from "@/routes/users";

interface AppVariables extends AuthVariables {
	debugCorrelationId: string;
}

interface AppOptions {
	adminSettingsEnvResolver?: AdminSettingsEnvResolver;
	authHandler: (request: Request) => Response | Promise<Response>;
	corsOrigins: string[];
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
	promptEnhanceEnv?: {
		grokConfigured: boolean;
		openRouterConfigured: boolean;
		openRouterModel: string;
	};
	promptEnhanceSettings?: PromptEnhanceSettings;
	s3Config?: S3StorageConfig;
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
			allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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

	if (options.loraRegistryService) {
		app.route(
			"/api/admin/loras",
			createAdminLoraRoutes(options.loraRegistryService)
		);
	}

	if (options.usersService) {
		app.route("/api/admin/users", createAdminUserRoutes(options.usersService));
	}

	if (
		options.trainingProviderSettings &&
		options.trainingProviderAvailability
	) {
		app.route(
			"/api/admin/training-provider",
			createTrainingProviderRoutes({
				availability: options.trainingProviderAvailability,
				settings: options.trainingProviderSettings,
				workerSettingsReader: options.workerSettingsReader,
			})
		);

		if (options.promptEnhanceSettings && options.promptEnhanceEnv) {
			app.route(
				"/api/admin/prompt-enhance-provider",
				createPromptEnhanceProviderRoutes({
					promptEnhanceEnv: options.promptEnhanceEnv,
					settings: options.promptEnhanceSettings,
				})
			);
		}

		if (options.adminSettingsEnvResolver) {
			app.route(
				"/api/admin/settings",
				createAdminSettingsRoutes({
					availability: options.trainingProviderAvailability,
					envResolver: options.adminSettingsEnvResolver,
					...(options.promptEnhanceSettings && options.promptEnhanceEnv
						? {
								promptEnhanceEnv: options.promptEnhanceEnv,
								promptEnhanceSettings: options.promptEnhanceSettings,
							}
						: {}),
					settings: options.trainingProviderSettings,
					workerSettingsReader: options.workerSettingsReader,
				})
			);
		}
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
