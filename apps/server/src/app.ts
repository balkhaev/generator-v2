import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { OperatorService, type OperatorRepository } from "@/domain/operator";
import { createRunpodClient, type RunpodClient } from "@/providers/runpod";
import { createStorageAdapter, type StorageAdapter } from "@/providers/storage";
import { createRunRoutes } from "@/routes/runs";
import { createScenarioRoutes } from "@/routes/scenarios";
import { createWorkflowRoutes } from "@/routes/workflows";

type AppOptions = {
  corsOrigin: string;
  repository: OperatorRepository;
  authHandler?: (request: Request) => Response | Promise<Response>;
  runpodClient?: RunpodClient;
  storageAdapter?: StorageAdapter;
  loggerImpl?: Pick<Console, "info" | "error">;
};

export function createApp(options: AppOptions) {
  const operatorService = new OperatorService(
    options.repository,
    options.runpodClient ?? createRunpodClient(),
    options.storageAdapter ?? createStorageAdapter(),
    options.loggerImpl,
  );

  const app = new Hono();

  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: options.corsOrigin,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  if (options.authHandler) {
    app.on(["POST", "GET"], "/api/auth/*", (c) => options.authHandler!(c.req.raw));
  }

  app.get("/", (c) => c.text("OK"));
  app.get("/api/health", (c) => {
    return c.json({
      ok: true,
      workflows: operatorService.listWorkflows().length,
    });
  });

  app.route("/api/workflows", createWorkflowRoutes(operatorService));
  app.route("/api/scenarios", createScenarioRoutes(operatorService));
  app.route("/api/runs", createRunRoutes(operatorService));

  app.onError((error, c) => {
    options.loggerImpl?.error("server.error", error);
    return c.json({ error: error.message }, 500);
  });

  return app;
}
