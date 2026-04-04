import { Hono } from "hono";

import { type OperatorService } from "@/domain/operator";

export function createWorkflowRoutes(service: OperatorService) {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({ workflows: service.listWorkflows() });
  });

  return app;
}
