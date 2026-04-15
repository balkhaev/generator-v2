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
import {
	DEBUG_CORRELATION_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { AssetReleasePresetService } from "@/domain/asset-release-presets";
import type { AssetReleaseService } from "@/domain/asset-releases";
import type { PersonLoraTrainingControl } from "@/domain/person-lora-training-control";
import { createAssetReleasePresetRoutes } from "@/routes/asset-release-presets";
import { createAssetReleaseRoutes } from "@/routes/asset-releases";
import { createInternalRoutes } from "@/routes/internal";

interface AppVariables extends AuthVariables {
	debugCorrelationId: string;
}

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

interface AppOptions {
	assetReleasePresetService?: AssetReleasePresetService;
	assetReleaseService?: AssetReleaseService;
	authHandler: (request: Request) => Response | Promise<Response>;
	corsOrigins: string[];
	fetchImpl?: FetchLike;
	generatorBaseUrl: string;
	getSession: (
		request: Request
	) => Promise<{ session: unknown; user: unknown } | null>;
	internalTrainingControlService?: PersonLoraTrainingControl;
	loadDashboardSnapshot: () => Promise<AdminDashboardSnapshot>;
	loadSetupStatus: () => Promise<AdminSetupStatus>;
	loggerImpl?: Pick<Console, "info" | "error">;
	studioBaseUrl: string;
}

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health", "/api/setup/status"],
	prefixes: ["/api/auth/", "/api/internal/"],
});

async function proxyGeneratorRequest(
	c: Context<{ Variables: AppVariables }>,
	fetchImpl: FetchLike,
	generatorBaseUrl: string
) {
	const requestUrl = new URL(c.req.url);
	const targetUrl = new URL(
		`${c.req.path}${requestUrl.search}`,
		`${normalizeBaseUrl(generatorBaseUrl)}/`
	);
	const headers = new Headers();
	const contentType = c.req.header("content-type");
	const accept = c.req.header("accept");
	const authorization = c.req.header("authorization");
	const debugCorrelationId = c.get("debugCorrelationId");

	if (contentType) {
		headers.set("content-type", contentType);
	}

	if (accept) {
		headers.set("accept", accept);
	}

	if (authorization) {
		headers.set("authorization", authorization);
	}

	headers.set(DEBUG_CORRELATION_HEADER, debugCorrelationId);

	const init: RequestInit = {
		headers,
		method: c.req.method,
	};

	if (!(c.req.method === "GET" || c.req.method === "HEAD")) {
		init.body = await c.req.raw.clone().arrayBuffer();
	}

	const response = await fetchImpl(targetUrl, init);
	const responseHeaders = new Headers();
	const responseContentType = response.headers.get("content-type");
	const responseDebugCorrelationId =
		response.headers.get(DEBUG_CORRELATION_HEADER) ?? debugCorrelationId;

	if (responseContentType) {
		responseHeaders.set("content-type", responseContentType);
	}
	responseHeaders.set(DEBUG_CORRELATION_HEADER, responseDebugCorrelationId);

	return new Response(response.body, {
		headers: responseHeaders,
		status: response.status,
	});
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
			isPublicPath: isPublicApiPath,
		})
	);

	app.on(
		["GET", "POST"],
		"/api/auth/*",
		createAuthHandler(options.authHandler)
	);

	app.get("/", (c) => c.text("OK"));
	app.get("/api/health", (c) =>
		c.json({
			gateway: true,
			ok: true,
		})
	);
	app.get("/api/setup/status", async (c) =>
		c.json(await options.loadSetupStatus())
	);
	app.get("/api/dashboard", async (c) =>
		c.json(await options.loadDashboardSnapshot())
	);

	if (options.assetReleaseService) {
		app.route(
			"/api/asset-releases",
			createAssetReleaseRoutes(options.assetReleaseService)
		);
	}

	if (options.assetReleasePresetService) {
		app.route(
			"/api/asset-release-presets",
			createAssetReleasePresetRoutes(options.assetReleasePresetService)
		);
	}

	if (options.internalTrainingControlService) {
		app.route(
			"/api/internal",
			createInternalRoutes(options.internalTrainingControlService)
		);
	}

	for (const route of ["/api/workflows", "/api/workflows/*"]) {
		app.all(route, (c) =>
			proxyGeneratorRequest(c, fetchImpl, options.studioBaseUrl)
		);
	}

	for (const route of ["/api/scenarios", "/api/scenarios/*"]) {
		app.all(route, (c) =>
			proxyGeneratorRequest(c, fetchImpl, options.studioBaseUrl)
		);
	}

	for (const route of ["/api/runs", "/api/runs/*"]) {
		app.all(route, (c) =>
			proxyGeneratorRequest(c, fetchImpl, options.studioBaseUrl)
		);
	}

	app.onError((error, c) => {
		c.header(DEBUG_CORRELATION_HEADER, c.get("debugCorrelationId"));
		options.loggerImpl?.error("admin.error", error);
		return c.json({ error: error.message }, 500);
	});

	return app;
}
