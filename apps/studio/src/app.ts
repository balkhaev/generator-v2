import type { AuthVariables } from "@generator/auth/middleware";
import {
	createAuthHandler,
	createSessionMiddleware,
} from "@generator/auth/middleware";
import { createPublicPathMatcher } from "@generator/auth/public-paths";
import type { WorkflowSummary as ServerWorkflowSummary } from "@generator/contracts/generator";
import type { StudioShotRecord } from "@generator/contracts/studio";
import { pingDatabase } from "@generator/db/health";
import type { LoraReadRepository } from "@generator/db/repositories/lora-read";
import { proxyHttpRequest } from "@generator/http/proxy";
import {
	DEBUG_CORRELATION_HEADER,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import type { S3ClientLike, S3StorageConfig } from "@generator/storage";
import { listWorkflows } from "@generator/workflows";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";
import type { StudioExecutionClient, StudioRepository } from "@/domain/studio";
import { StudioService } from "@/domain/studio";
import { resolveStudioPromptEnhanceClient } from "@/prompt-enhance-resolve";
import { createEnhanceRoutes } from "@/routes/enhance";
import { createInputAssetRoutes } from "@/routes/input-assets";
import { createInternalRoutes } from "@/routes/internal";
import { createLoraRoutes } from "@/routes/loras";
import { createRunRoutes } from "@/routes/runs";
import { createScenarioRoutes } from "@/routes/scenarios";
import { createShotRoutes } from "@/routes/shots";

interface AppVariables extends AuthVariables {
	debugCorrelationId: string;
}

interface AppOptions {
	authHandler: (request: Request) => Response | Promise<Response>;
	callbackConfig?: {
		token: string;
		url?: string;
	};
	corsOrigins: string[];
	executionClient: StudioExecutionClient;
	fetchImpl?: (
		input: string | URL | Request,
		init?: RequestInit
	) => Promise<Response>;
	generatorBaseUrl: string;
	getSession: (
		request: Request
	) => Promise<{ session: unknown; user: unknown } | null>;
	loggerImpl?: Pick<Console, "info" | "error" | "warn">;
	loraReadRepository?: LoraReadRepository;
	/** Base URL persons-api (same cookie domain) — для подстановки LoRA персоны в ран. */
	personsApiBaseUrl?: string;
	repository: StudioRepository;
	/**
	 * По умолчанию — провайдер и ключи берутся через runtime-config snapshot
	 * c admin-api (см. `prompt-enhance-resolve.ts`); env остаётся как fallback,
	 * если admin-api недоступен. Параметр оставлен для подмены в тестах.
	 */
	resolvePromptEnhanceClient?: () => Promise<PromptEnhanceClient | undefined>;
	s3Client?: S3ClientLike;
	s3Config: S3StorageConfig;
}

interface WorkflowDefinition {
	baseModel?: string;
	key: string;
	name: string;
	parameters: Array<{
		defaultValue: string;
		enumValues?: readonly string[];
		helperText: string;
		key: string;
		kind?: string;
		label: string;
		max?: number;
		min?: number;
		optional?: boolean;
		step?: number;
		type: string;
		unit?: string;
	}>;
	promptHint: string;
	requiresInputImage: boolean;
	summary: string;
}

interface StudioSnapshotResponse {
	runs: Awaited<ReturnType<StudioService["listRunsWire"]>>;
	scenarios: Awaited<ReturnType<StudioService["listScenarios"]>>;
	shots: Array<StudioShotRecord & { scenarioName: string }>;
	source: "server";
	workflows: WorkflowDefinition[];
}

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health", "/api/ready", "/api/studio-snapshot"],
	prefixes: ["/api/auth/", "/api/internal/"],
});

function createPromptHint(workflowName: string) {
	return `Describe the ${workflowName} shot, camera movement, and effect you want the generated clip to amplify.`;
}

function createNoopLoraReadRepository(): LoraReadRepository {
	return {
		getById() {
			return Promise.resolve(null);
		},
		getByPairGroupId() {
			return Promise.resolve([]);
		},
		getByS3Urls() {
			return Promise.resolve([]);
		},
		getBySlug() {
			return Promise.resolve(null);
		},
		list() {
			return Promise.resolve([]);
		},
	};
}

function stringifyParamValue(value: unknown) {
	if (value === undefined || value === null) {
		return "";
	}

	return String(value);
}

function normalizeWorkflowDefinition(
	workflow: ServerWorkflowSummary
): WorkflowDefinition {
	return {
		baseModel: workflow.baseModel,
		key: workflow.key,
		name: workflow.name,
		parameters: (workflow.parameterFields ?? []).map((parameter) => ({
			defaultValue: stringifyParamValue(workflow.defaults?.[parameter.key]),
			...(parameter.enumValues ? { enumValues: parameter.enumValues } : {}),
			helperText: parameter.description,
			key: parameter.key,
			...(parameter.kind ? { kind: parameter.kind } : {}),
			label: parameter.label,
			...(parameter.max === undefined ? {} : { max: parameter.max }),
			...(parameter.min === undefined ? {} : { min: parameter.min }),
			...(parameter.optional ? { optional: parameter.optional } : {}),
			...(parameter.step === undefined ? {} : { step: parameter.step }),
			type: parameter.type,
			...(parameter.unit ? { unit: parameter.unit } : {}),
		})),
		promptHint: createPromptHint(workflow.name),
		requiresInputImage: Boolean(workflow.requiresInputImage),
		summary: workflow.description,
	};
}

async function createStudioSnapshot(
	service: StudioService
): Promise<StudioSnapshotResponse> {
	const [scenarios, runs, shots] = await Promise.all([
		service.listScenarios(),
		service.listRunsWire(),
		service.listShots().catch(() => [] as StudioShotRecord[]),
	]);
	const scenarioNames = new Map(
		scenarios.map((scenario) => [scenario.id, scenario.name])
	);

	return {
		runs,
		scenarios,
		shots: shots.map((shot) => ({
			...shot,
			scenarioName: scenarioNames.get(shot.scenarioId) ?? "Unknown scenario",
		})),
		source: "server",
		workflows: listWorkflows().map((workflow) =>
			normalizeWorkflowDefinition(workflow as ServerWorkflowSummary)
		),
	};
}

export function createApp(options: AppOptions): {
	app: Hono<{ Variables: AppVariables }>;
	service: StudioService;
} {
	const app = new Hono<{ Variables: AppVariables }>();
	const loraReadRepository =
		options.loraReadRepository ?? createNoopLoraReadRepository();
	const service = new StudioService(
		options.repository,
		options.executionClient,
		options.loggerImpl,
		options.callbackConfig,
		{
			fetchImpl: options.fetchImpl,
			loraReadRepository,
			personsApiBaseUrl: options.personsApiBaseUrl,
		}
	);
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
			isPublicPath: isPublicApiPath,
		})
	);

	app.on(
		["GET", "POST"],
		"/api/auth/*",
		createAuthHandler(options.authHandler)
	);

	app.get("/", (c) => c.text("OK"));
	// Liveness: подтверждает только что процесс жив. БД и схему НЕ трогает,
	// чтобы health-check Docker/Coolify не убивал контейнер из-за временных
	// проблем БД или несоответствия схемы во время прокатки миграций.
	app.get("/api/health", (c) =>
		c.json({
			ok: true,
			service: "studio",
		})
	);
	// Readiness: лёгкий пинг БД (`select 1`). Не использовать для health-check
	// деплоя — только для диагностики и ручных проверок.
	app.get("/api/ready", async (c) => {
		try {
			await pingDatabase();
			return c.json({ ok: true });
		} catch (error) {
			options.loggerImpl?.warn?.("studio.ready.failed", {
				error: error instanceof Error ? error.message : String(error),
			});
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
	app.get("/api/studio-snapshot", async (c) =>
		c.json(await createStudioSnapshot(service))
	);
	app.get("/api/workflows", (c) =>
		c.json({
			workflows: listWorkflows(),
		})
	);
	for (const route of ["/api/executions", "/api/executions/*"]) {
		app.all(route, (c) =>
			proxyHttpRequest({
				debugCorrelationId: c.get("debugCorrelationId"),
				fetchImpl,
				request: c.req.raw,
				targetBaseUrl: options.generatorBaseUrl,
			})
		);
	}
	app.route("/api/scenarios", createScenarioRoutes(service));
	app.route("/api/runs", createRunRoutes(service));
	app.route("/api/scenario-shots", createShotRoutes(service));
	app.route("/api/internal", createInternalRoutes(service));
	app.route(
		"/api/enhance-prompt",
		createEnhanceRoutes({
			resolveClient:
				options.resolvePromptEnhanceClient ?? resolveStudioPromptEnhanceClient,
		})
	);
	app.route("/api/loras", createLoraRoutes(loraReadRepository));
	app.route(
		"/api/input-assets",
		createInputAssetRoutes({
			logger: options.loggerImpl,
			s3Client: options.s3Client,
			s3Config: options.s3Config,
		})
	);
	app.onError((error, c) => {
		c.header(DEBUG_CORRELATION_HEADER, c.get("debugCorrelationId"));
		options.loggerImpl?.error("studio.error", error);
		return c.json({ error: error.message }, 500);
	});

	return { app, service };
}
