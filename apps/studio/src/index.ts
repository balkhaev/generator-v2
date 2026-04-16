import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
} from "@generator/auth";
import {
	env,
	getGeneratorApiUrl,
	getGeneratorCallbackToken,
	getRequiredCorsOrigins,
	getTrainingControlToken,
} from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { createApp } from "@/app";
import { createAdminLoraClient } from "@/clients/admin-loras";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const PORT = Number(process.env.PORT ?? 3006);

const generatorBaseUrl = getGeneratorApiUrl();
const repository = createDrizzleStudioRepository();

const adminApiUrl = env.STUDIO_ADMIN_URL ?? env.ADMIN_API_URL;
const adminLoraClient = adminApiUrl
	? createAdminLoraClient(adminApiUrl, getTrainingControlToken())
	: undefined;

const app = createApp({
	adminLoraClient,
	authHandler: handleAuthRequest,
	callbackConfig: {
		token: getGeneratorCallbackToken(),
		url: `${env.STUDIO_API_URL ?? `http://localhost:${PORT}`}/api/internal/generator-executions`,
	},
	corsOrigins: getRequiredCorsOrigins(),
	generatorBaseUrl,
	executionClient: createGeneratorExecutionClient(generatorBaseUrl),
	getSession: getRequestSession,
	loggerImpl: console,
	repository,
});

ensureDevUser();

export default {
	port: PORT,
	fetch: app.fetch,
};
