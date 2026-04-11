import { Hono } from "hono";

import type { ExecutionService } from "@/domain/executions";

export function createWorkflowRoutes(service: ExecutionService) {
	const app = new Hono();

	app.get("/", (c) => {
		return c.json({ workflows: service.listWorkflows() });
	});

	return app;
}
