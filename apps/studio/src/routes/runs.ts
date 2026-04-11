import { Hono } from "hono";

import type { StudioService } from "@/domain/studio";
import { toErrorResponse } from "@/routes/utils";

export function createRunRoutes(service: StudioService) {
	const app = new Hono<{
		Variables: {
			debugCorrelationId: string;
		};
	}>();

	app.get("/", async (c) => c.json({ runs: await service.listRuns() }));

	app.post("/", async (c) => {
		try {
			const payload = await c.req.json();
			const run = await service.launchRun(payload, {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return c.json({ run }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	app.get("/:runId", async (c) => {
		const run = await service.getRunById(c.req.param("runId"));
		return run ? c.json({ run }) : c.json({ error: "Run not found" }, 404);
	});

	app.post("/:runId/sync", async (c) => {
		try {
			const run = await service.syncRun(c.req.param("runId"), {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return run ? c.json({ run }) : c.json({ error: "Run not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	return app;
}
