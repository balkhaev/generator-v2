import { auth } from "@generator/auth";
import { env } from "@generator/env/server";

import { createApp } from "@/app";
import { createDrizzleOperatorRepository } from "@/repositories/operator";

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  repository: createDrizzleOperatorRepository(),
  authHandler: (request) => auth.handler(request),
  loggerImpl: console,
});

export default app;
