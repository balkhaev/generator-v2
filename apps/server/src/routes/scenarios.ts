import { Hono } from "hono";

import { type OperatorService } from "@/domain/operator";
import { toErrorResponse } from "@/routes/utils";

export function createScenarioRoutes(service: OperatorService) {
  const app = new Hono();

  app.get("/", async (c) => {
    return c.json({ scenarios: await service.listScenarios() });
  });

  app.post("/", async (c) => {
    try {
      const payload = await c.req.json();
      const scenario = await service.createScenario(payload);
      return c.json({ scenario }, 201);
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json(response.body, response.status as 400);
    }
  });

  app.get("/:scenarioId", async (c) => {
    const scenario = await service.getScenarioById(c.req.param("scenarioId"));
    if (!scenario) {
      return c.json({ error: "Scenario not found" }, 404);
    }
    return c.json({ scenario });
  });

  app.patch("/:scenarioId", async (c) => {
    try {
      const payload = await c.req.json();
      const scenario = await service.updateScenario(c.req.param("scenarioId"), payload);
      if (!scenario) {
        return c.json({ error: "Scenario not found" }, 404);
      }
      return c.json({ scenario });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json(response.body, response.status as 400);
    }
  });

  app.delete("/:scenarioId", async (c) => {
    const deleted = await service.deleteScenario(c.req.param("scenarioId"));
    return deleted ? c.body(null, 204) : c.json({ error: "Scenario not found" }, 404);
  });

  return app;
}
