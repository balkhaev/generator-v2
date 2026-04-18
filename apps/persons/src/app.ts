import type { AuthVariables } from "@generator/auth/middleware";
import {
	createAuthHandler,
	createSessionMiddleware,
} from "@generator/auth/middleware";
import { createPublicPathMatcher } from "@generator/auth/public-paths";
import type { LoraReadRepository } from "@generator/db/repositories/lora-read";
import {
	DEBUG_CORRELATION_HEADER,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { AdminTrainingClient } from "@/clients/admin-training";
import type { GrokClient } from "@/clients/grok";
import type { OperatorServerClient, PersonsRepository } from "@/domain/persons";
import { PersonsService } from "@/domain/persons";
import { createEnhanceRoutes } from "@/routes/enhance";
import { createInputAssetRoutes } from "@/routes/input-assets";
import { createIntegrationRoutes } from "@/routes/integrations";
import { createInternalRoutes } from "@/routes/internal";
import { createLoraRoutes } from "@/routes/loras";
import { createPersonRoutes } from "@/routes/persons";

interface AppOptions {
	adminTrainingClient?: AdminTrainingClient;
	authHandler?: (request: Request) => Response | Promise<Response>;
	callbackConfig?: {
		token: string;
		url?: string;
	};
	corsOrigins: string[];
	getSession?: (
		request: Request
	) => Promise<{ session: unknown; user: unknown } | null>;
	grokClient?: GrokClient;
	loraReadRepository?: LoraReadRepository;
	operatorServerClient?: OperatorServerClient;
	repository: PersonsRepository;
}

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health"],
	prefixes: ["/api/auth/", "/api/internal/"],
});

export function createApp(options: AppOptions) {
	const service = new PersonsService({
		adminTrainingClient: options.adminTrainingClient,
		callbackConfig: options.callbackConfig,
		grokClient: options.grokClient,
		operatorServerClient: options.operatorServerClient,
		repository: options.repository,
	});
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
	app.route("/api/enhance-prompt", createEnhanceRoutes(options.grokClient));
	app.route("/api/input-assets", createInputAssetRoutes());
	if (options.loraReadRepository) {
		app.route("/api/loras", createLoraRoutes(options.loraReadRepository));
	}

	app.onError((error, c) => {
		c.header(DEBUG_CORRELATION_HEADER, c.get("debugCorrelationId"));
		return c.json({ error: error.message }, 500);
	});

	return app;
}
