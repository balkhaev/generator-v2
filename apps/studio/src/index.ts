import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
} from "@generator/auth";
import {
	env,
	getAdminApiUrl,
	getGeneratorApiUrl,
	getGeneratorCallbackToken,
	getRequiredCorsOrigins,
	getTrainingControlToken,
} from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { resolveS3StorageConfig } from "@generator/storage";
import { createApp } from "@/app";
import { createAdminLoraClient } from "@/clients/admin-loras";
import { createStudioGrokClient } from "@/clients/grok";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const PORT = Number(process.env.PORT ?? 3006);

const generatorBaseUrl = getGeneratorApiUrl();
const repository = createDrizzleStudioRepository();

const adminLoraClient = createAdminLoraClient(
	getAdminApiUrl(),
	getTrainingControlToken()
);

const grokClient = env.XAI_API_KEY
	? createStudioGrokClient({ apiKey: env.XAI_API_KEY })
	: undefined;

const app = createApp({
	adminLoraClient,
	authHandler: handleAuthRequest,
	callbackConfig: {
		token: getGeneratorCallbackToken(),
	},
	corsOrigins: getRequiredCorsOrigins(),
	generatorBaseUrl,
	executionClient: createGeneratorExecutionClient(generatorBaseUrl),
	getSession: getRequestSession,
	grokClient,
	loggerImpl: console,
	repository,
	s3Config: resolveS3StorageConfig(process.env),
});

ensureDevUser();

export default {
	port: PORT,
	fetch: app.fetch,
};
