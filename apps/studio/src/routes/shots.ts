import { Hono } from "hono";

import type { StudioService } from "@/domain/studio";
import { toErrorResponse } from "@/routes/utils";

export function createShotRoutes(service: StudioService) {
	const app = new Hono<{
		Variables: {
			debugCorrelationId: string;
		};
	}>();

	app.get("/", async (c) => c.json({ shots: await service.listShots() }));

	app.post("/", async (c) => {
		try {
			const payload = await c.req.json();
			const shot = await service.createShot(payload);
			return c.json({ shot }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	app.delete("/:shotId", async (c) => {
		try {
			const ok = await service.deleteShot(c.req.param("shotId"));
			return ok
				? c.json({ ok: true })
				: c.json({ error: "Shot not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	return app;
}
