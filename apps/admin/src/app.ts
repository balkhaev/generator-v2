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
import { pingDatabase } from "@generator/db/health";
import { type FetchLike, proxyHttpRequest } from "@generator/http/proxy";
import {
	DEBUG_CORRELATION_HEADER,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import type { S3StorageConfig } from "@generator/storage";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { LoraRegistryService } from "@/domain/loras";
import type { PersonLoraTrainingControl } from "@/domain/person-lora-training-control";
import type { TrainingProviderSettings } from "@/domain/training-provider-settings";
import type { UsersService } from "@/domain/users";
import type { WorkerSettingsReader } from "@/domain/worker-settings-store";
import {
	type AdminSettingsEnvResolver,
	createAdminSettingsRoutes,
} from "@/routes/admin-settings";
import { createInternalRoutes } from "@/routes/internal";
import { createAdminLoraRoutes } from "@/routes/loras";
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

		if (options.adminSettingsEnvResolver) {
			app.route(
				"/api/admin/settings",
				createAdminSettingsRoutes({
					availability: options.trainingProviderAvailability,
					envResolver: options.adminSettingsEnvResolver,
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
