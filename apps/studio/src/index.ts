import { auth, ensureDevUser } from "@generator/auth";
import {
	getGeneratorApiUrl,
	getGeneratorCallbackToken,
	getRequiredCorsOrigins,
} from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { createApp } from "@/app";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const generatorBaseUrl = getGeneratorApiUrl();
const repository = createDrizzleStudioRepository();

const app = createApp({
	authHandler: (request) => auth.handler(request),
	callbackConfig: {
		token: getGeneratorCallbackToken(),
		url: `${process.env.STUDIO_API_URL ?? `http://localhost:${process.env.PORT ?? 3006}`}/api/internal/generator-executions`,
	},
	corsOrigins: getRequiredCorsOrigins(),
	generatorBaseUrl,
	executionClient: createGeneratorExecutionClient(generatorBaseUrl),
	getSession: (request) => auth.api.getSession({ headers: request.headers }),
	loggerImpl: console,
	repository,
});

ensureDevUser();

export default {
	port: Number(process.env.PORT ?? 3006),
	fetch: app.fetch,
};
