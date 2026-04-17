import { Hono } from "hono";

import type { ExecutionService } from "@/domain/executions";
import { toErrorResponse } from "@/routes/utils";

export function createExecutionRoutes(service: ExecutionService) {
	const app = new Hono<{
		Variables: {
			debugCorrelationId: string;
		};
	}>();

	app.post("/", async (c) => {
		try {
			const payload = await c.req.json();
			const execution = await service.createExecution(payload, {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return c.json({ execution }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	app.get("/:executionId", async (c) => {
		const execution = await service.getExecution(c.req.param("executionId"));
		if (!execution) {
			return c.json({ error: "Execution not found" }, 404);
		}
		return c.json({ execution });
	});

	app.post("/:executionId/cancel", async (c) => {
		try {
			const execution = await service.cancelExecution(
				c.req.param("executionId"),
				{
					debugCorrelationId: c.get("debugCorrelationId"),
				}
			);
			if (!execution) {
				return c.json({ error: "Execution not found" }, 404);
			}
			return c.json({ execution });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	app.post("/sync", async (c) => {
		try {
			const payload = await c.req.json();
			const execution = await service.syncExecution(payload, {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return c.json({ execution });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	return app;
}
