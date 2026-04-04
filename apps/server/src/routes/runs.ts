import { Hono } from "hono";

import { type OperatorService } from "@/domain/operator";
import { toErrorResponse } from "@/routes/utils";

export function createRunRoutes(service: OperatorService) {
  const app = new Hono();

  app.get("/", async (c) => {
    return c.json({ runs: await service.listRuns() });
  });

  app.post("/", async (c) => {
    try {
      const payload = await c.req.json();
      const run = await service.launchRun(payload);
      return c.json({ run }, 201);
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json(response.body, response.status as 400);
    }
  });

  app.get("/:runId", async (c) => {
    const run = await service.getRunById(c.req.param("runId"));
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json({ run });
  });

  app.post("/:runId/sync", async (c) => {
    try {
      const run = await service.syncRun(c.req.param("runId"));
      if (!run) {
        return c.json({ error: "Run not found" }, 404);
      }
      return c.json({ run });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json(response.body, response.status as 400);
    }
  });

  return app;
}
