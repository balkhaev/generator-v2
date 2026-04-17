import {
	listAssetReleasePresets,
	toAssetReleasePresetSummary,
} from "@generator/asset-release-presets";
import type { AuthVariables } from "@generator/auth/middleware";
import {
	createAuthHandler,
	createSessionMiddleware,
} from "@generator/auth/middleware";
import { createPublicPathMatcher } from "@generator/auth/public-paths";
import type {
	AssetReleasePreset,
	AssetReleaseSnapshot,
} from "@generator/contracts/admin";
import type { WorkflowSummary as ServerWorkflowSummary } from "@generator/contracts/generator";
import { proxyHttpRequest } from "@generator/http/proxy";
import {
	DEBUG_CORRELATION_HEADER,
	resolveDebugCorrelationId,
} from "@generator/http/shared";
import { listWorkflows } from "@generator/workflows";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import type { AdminLoraClient } from "@/clients/admin-loras";
import { AssetReleaseReadService } from "@/domain/asset-releases-read";
import type { StudioExecutionClient, StudioRepository } from "@/domain/studio";
import { StudioService } from "@/domain/studio";
import { createDrizzleAssetReleaseReadRepository } from "@/repositories/asset-releases-read";
import { createAssetReleasePresetRoutes } from "@/routes/asset-release-presets";
import { createInputAssetRoutes } from "@/routes/input-assets";
import { createInternalRoutes } from "@/routes/internal";
import { createLoraRoutes } from "@/routes/loras";
import { createRunRoutes } from "@/routes/runs";
import { createScenarioRoutes } from "@/routes/scenarios";

interface AppVariables extends AuthVariables {
	debugCorrelationId: string;
}

interface AppOptions {
	adminLoraClient?: AdminLoraClient;
	assetReleaseReadService?: AssetReleaseReadService;
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
	repository: StudioRepository;
}

interface WorkflowDefinition {
	baseModel?: string;
	key: string;
	name: string;
	parameters: Array<{
		defaultValue: string;
		helperText: string;
		key: string;
		kind?: string;
		label: string;
		type: string;
	}>;
	promptHint: string;
	summary: string;
}

interface StudioSnapshotResponse {
	presets: AssetReleasePreset[];
	releases: AssetReleaseSnapshot[];
	runs: Array<{
		artifactUrls: string[];
		createdAt?: string;
		errorSummary?: string | null;
		id: string;
		inputImageUrl: string;
		inputLabel: string;
		providerEndpointId?: string | null;
		providerJobId?: string | null;
		scenarioId: string;
		scenarioName: string;
		status: string;
		workflowKey: string;
	}>;
	scenarios: Awaited<ReturnType<StudioService["listScenarios"]>>;
	source: "server";
	warnings: string[];
	workflows: WorkflowDefinition[];
}

const fileExtensionPattern = /\.[a-z0-9]+$/i;

const isPublicApiPath = createPublicPathMatcher({
	exact: ["/api/health", "/api/studio-snapshot"],
	prefixes: ["/api/auth/", "/api/internal/"],
});

function formatInputLabel(inputImageUrl: string) {
	try {
		const url = new URL(inputImageUrl);
		const lastPathSegment = url.pathname
			.split("/")
			.filter(Boolean)
			.at(-1)
			?.replace(fileExtensionPattern, "");

		return lastPathSegment || url.hostname;
	} catch {
		return inputImageUrl;
	}
}

function createPromptHint(workflowName: string) {
	return `Describe the ${workflowName} shot, camera movement, and effect you want the generated clip to amplify.`;
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
			helperText: parameter.description,
			key: parameter.key,
			...(parameter.kind ? { kind: parameter.kind } : {}),
			label: parameter.label,
			type: parameter.type,
		})),
		promptHint: createPromptHint(workflow.name),
		summary: workflow.description,
	};
}

async function createStudioSnapshot(
	assetReleaseReadService: AssetReleaseReadService,
	service: StudioService
): Promise<StudioSnapshotResponse> {
	const [releasesResult, scenarios, runs] = await Promise.all([
		assetReleaseReadService
			.listReleases(6)
			.then((payload) => ({ payload, warning: null }))
			.catch((error) => ({
				payload: [] as AssetReleaseSnapshot[],
				warning:
					error instanceof Error
						? `Asset releases unavailable: ${error.message}`
						: "Asset releases unavailable.",
			})),
		service.listScenarios(),
		service.listRuns(),
	]);
	const scenarioNames = new Map(
		scenarios.map((scenario) => [scenario.id, scenario.name])
	);
	const warnings = [releasesResult.warning].filter(
		(warning): warning is string => Boolean(warning)
	);

	return {
		presets: listAssetReleasePresets().map(toAssetReleasePresetSummary),
		releases: releasesResult.payload,
		runs: runs.map((run) => ({
			artifactUrls: (run.artifacts ?? [])
				.flatMap((artifact) => artifact.url ?? [])
				.filter((artifactUrl): artifactUrl is string => Boolean(artifactUrl)),
			createdAt: run.createdAt,
			errorSummary: run.errorSummary ?? null,
			id: run.id,
			inputImageUrl: run.inputImageUrl,
			inputLabel: formatInputLabel(run.inputImageUrl),
			providerEndpointId: run.providerEndpointId ?? null,
			providerJobId: run.providerJobId ?? null,
			scenarioId: run.scenarioId,
			scenarioName: scenarioNames.get(run.scenarioId) ?? "Unknown scenario",
			status: run.status,
			workflowKey: run.workflowKey,
		})),
		scenarios,
		source: "server",
		warnings,
		workflows: listWorkflows().map((workflow) =>
			normalizeWorkflowDefinition(workflow as ServerWorkflowSummary)
		),
	};
}

export function createApp(options: AppOptions) {
	const app = new Hono<{ Variables: AppVariables }>();
	const service = new StudioService(
		options.repository,
		options.executionClient,
		options.loggerImpl,
		options.callbackConfig
	);
	const assetReleaseReadService =
		options.assetReleaseReadService ??
		new AssetReleaseReadService(createDrizzleAssetReleaseReadRepository());
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
	app.get("/api/health", async (c) =>
		c.json({
			ok: true,
			runs: (await service.listRuns()).length,
			scenarios: (await service.listScenarios()).length,
		})
	);
	app.get("/api/studio-snapshot", async (c) =>
		c.json(await createStudioSnapshot(assetReleaseReadService, service))
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
	app.route("/api/internal", createInternalRoutes(service));
	if (options.adminLoraClient) {
		app.route("/api/loras", createLoraRoutes(options.adminLoraClient));
	}
	app.route(
		"/api/input-assets",
		createInputAssetRoutes({ logger: options.loggerImpl })
	);
	app.get("/api/asset-releases", async (c) => {
		const limit = Number(c.req.query("limit") ?? 6);
		const releases = await assetReleaseReadService.listReleases(
			Number.isFinite(limit) ? Math.max(1, Math.min(limit, 20)) : 6
		);
		return c.json({ releases });
	});
	app.route("/api/asset-release-presets", createAssetReleasePresetRoutes());

	app.onError((error, c) => {
		c.header(DEBUG_CORRELATION_HEADER, c.get("debugCorrelationId"));
		options.loggerImpl?.error("studio.error", error);
		return c.json({ error: error.message }, 500);
	});

	return app;
}
