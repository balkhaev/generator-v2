import type { AuthVariables } from "@generator/auth/middleware";
import { createSessionMiddleware } from "@generator/auth/middleware";
import { createPublicPathMatcher } from "@generator/auth/public-paths";
import type { EventPublisher } from "@generator/events";
import {
	DEBUG_CORRELATION_HEADER,
	GENERATOR_INTERNAL_TOKEN_HEADER,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
	type ExecutionRepository,
	ExecutionService,
} from "@/domain/executions";
import { createFalClient } from "@/providers/fal";
import type { InferenceClient } from "@/providers/inference";
import { createInferenceRouter } from "@/providers/inference-router";

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

import { createStorageAdapter, type StorageAdapter } from "@/providers/storage";
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
	loggerImpl?: Pick<Console, "info" | "error">;
	redisUrl?: string;
	storageAdapter?: StorageAdapter;
}

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health"],
});

export function createApp(options: AppOptions) {
	// Читаем переменные напрямую из process.env: тесты мутируют их в рантайме,
	// а централизованный `env` из @generator/env/server валидируется при импорте
	// и кэшируется при первом доступе. Централизация сохраняется на уровне
	// входных точек (index.ts/worker.ts); здесь нужен доступ без валидации.
	const internalToken = process.env.GENERATOR_INTERNAL_TOKEN?.trim();
	const storageAdapter = options.storageAdapter ?? createStorageAdapter();
	const falKey = process.env.FAL_KEY;

	const falClient = falKey ? createFalClient({ apiKey: falKey }) : undefined;

	const inferenceClient =
		options.inferenceClient ??
		(falClient
			? createInferenceRouter({
					fal: falClient,
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
				allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
	app.get("/api/health", (c) => {
		return c.json({
			ok: true,
			workflows: executionService.listWorkflows().length,
		});
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
