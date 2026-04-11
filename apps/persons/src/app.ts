import type { AuthVariables } from "@generator/auth/middleware";
import {
	createAuthHandler,
	createSessionMiddleware,
} from "@generator/auth/middleware";
import {
	DEBUG_CORRELATION_HEADER,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { AdminTrainingClient } from "@/clients/admin-training";
import type { OperatorServerClient, PersonsRepository } from "@/domain/persons";
import { PersonsService } from "@/domain/persons";
import { createIntegrationRoutes } from "@/routes/integrations";
import { createInternalRoutes } from "@/routes/internal";
import { createPersonRoutes } from "@/routes/persons";

interface AppOptions {
	adminTrainingClient?: AdminTrainingClient;
	authHandler?: (request: Request) => Response | Promise<Response>;
	callbackConfig?: {
		token: string;
		url: string;
	};
	corsOrigins: string[];
	getSession?: (
		request: Request
	) => Promise<{ session: unknown; user: unknown } | null>;
	operatorServerClient?: OperatorServerClient;
	repository: PersonsRepository;
}

function isPublicApiPath(path: string) {
	return (
		path === "/api/health" ||
		path.startsWith("/api/auth/") ||
		path.startsWith("/api/internal/")
	);
}

export function createApp(options: AppOptions) {
	const service = new PersonsService(
		options.repository,
		options.operatorServerClient,
		options.callbackConfig,
		options.adminTrainingClient
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
	app.use(
		"/*",
		cors({
			origin: options.corsOrigins,
			allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", DEBUG_CORRELATION_HEADER],
			credentials: true,
		})
	);
	if (options.getSession) {
		app.use(
			"/api/*",
			createSessionMiddleware({
				getSession: options.getSession,
				isPublicPath: isPublicApiPath,
			})
		);
	}
	if (options.authHandler) {
		app.on(
			["GET", "POST"],
			"/api/auth/*",
			createAuthHandler(options.authHandler)
		);
	}

	app.get("/", (c) => c.text("OK"));
	app.get("/api/health", async (c) => {
		const persons = await service.listPersons();
		return c.json({
			ok: true,
			persons: persons.length,
		});
	});

	app.route("/api/persons", createPersonRoutes(service));
	app.route("/api/integrations", createIntegrationRoutes(service));
	app.route("/api/internal", createInternalRoutes(service));

	app.onError((error, c) => {
		c.header(DEBUG_CORRELATION_HEADER, c.get("debugCorrelationId"));
		return c.json({ error: error.message }, 500);
	});

	return app;
}
