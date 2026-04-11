import { Hono } from "hono";

import type { PersonsService } from "@/domain/persons";

export function createIntegrationRoutes(service: PersonsService) {
	const app = new Hono();

	app.get("/server", async (c) => {
		return c.json(await service.getServerHealth());
	});

	return app;
}
