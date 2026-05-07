import { getGeneratorCallbackToken } from "@generator/env/server";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";
import { Hono } from "hono";
import { z } from "zod";

import type { StudioService } from "@/domain/studio";

const callbackPayloadSchema = z.object({
	context: z.record(z.string(), z.unknown()),
	execution: z
		.object({
			artifacts: z.array(z.object({ url: z.string().nullable().optional() })),
			errorSummary: z.string().nullable(),
			id: z.string().min(1),
			inputImageUrl: z.string(),
			providerEndpointId: z.string().nullable(),
			providerJobId: z.string().nullable(),
			status: z.enum(["queued", "running", "succeeded", "failed"]),
			workflowKey: z.string().min(1),
		})
		.passthrough(),
});

const markFailedPayloadSchema = z.object({
	errorSummary: z.string().trim().min(1).max(500).optional(),
});

// Точечный апдейт сценария по callback-токену. Поля совпадают с
// updateStudioScenarioInputSchema, но дублированы здесь, чтобы не тащить zod
// схему из домена (избегаем циклической зависимости routes → domain → routes).
// MCP-tool studio_scenario_update патчит сценарии (например, миграция
// workflowKey старых сценариев на новый pipeline) без участия пользователя.
const scenarioUpdatePayloadSchema = z
	.object({
		name: z.string().trim().min(1).optional(),
		params: z.record(z.string(), z.unknown()).optional(),
		prompt: z.string().trim().min(1).optional(),
		workflowKey: z.string().trim().min(1).optional(),
	})
	.refine(
		(value) => Object.keys(value).length > 0,
		"At least one field must be provided"
	);

export function createInternalRoutes(service: StudioService) {
	const app = new Hono();

	app.get("/runs/:runId", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (token !== getGeneratorCallbackToken()) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const bundle = await service.getRunDebugBundle(c.req.param("runId"));
		return bundle ? c.json(bundle) : c.json({ error: "Run not found" }, 404);
	});

	app.post("/generator-executions", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (token !== getGeneratorCallbackToken()) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const body = await c.req.json();
		const result = callbackPayloadSchema.safeParse(body);
		if (!result.success) {
			return c.json(
				{ error: "Invalid callback payload", issues: result.error.issues },
				400
			);
		}

		const run = await service.applyExecutionCallback(result.data);
		return c.json({ run });
	});

	// Точечная зачистка orphan-ров (MCP-tool studio_run_mark_failed).
	// Авторизация — тем же callback-токеном, что и /generator-executions:
	// доверенный канал между внутренними сервисами (mcp / debug-tools).
	app.post("/runs/:runId/mark-failed", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (token !== getGeneratorCallbackToken()) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const body = await c.req.json().catch(() => ({}) as unknown);
		const result = markFailedPayloadSchema.safeParse(body);
		if (!result.success) {
			return c.json(
				{ error: "Invalid payload", issues: result.error.issues },
				400
			);
		}

		const run = await service.markRunFailed(
			c.req.param("runId"),
			result.data.errorSummary ?? "Marked failed via internal MCP tool"
		);
		if (!run) {
			return c.json({ error: "Run not found" }, 404);
		}
		return c.json({ run });
	});

	app.patch("/scenarios/:scenarioId", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (token !== getGeneratorCallbackToken()) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const body = await c.req.json().catch(() => ({}) as unknown);
		const result = scenarioUpdatePayloadSchema.safeParse(body);
		if (!result.success) {
			return c.json(
				{ error: "Invalid payload", issues: result.error.issues },
				400
			);
		}

		try {
			const scenario = await service.updateScenario(
				c.req.param("scenarioId"),
				result.data
			);
			if (!scenario) {
				return c.json({ error: "Scenario not found" }, 404);
			}
			return c.json({ scenario });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 400);
		}
	});

	return app;
}
