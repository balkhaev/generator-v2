import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
} from "@generator/auth";
import { createLoraReadRepository } from "@generator/db/repositories/lora-read";
import {
	env,
	getGeneratorApiUrl,
	getGeneratorCallbackToken,
	getGeneratorInternalToken,
	getRequiredCorsOrigins,
} from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { resolveS3StorageConfig } from "@generator/storage";
import { createApp } from "@/app";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const PORT = Number(process.env.PORT ?? 3006);

const generatorBaseUrl = getGeneratorApiUrl();
const repository = createDrizzleStudioRepository();
const loraReadRepository = createLoraReadRepository();

const app = createApp({
	authHandler: handleAuthRequest,
	callbackConfig: {
		token: getGeneratorCallbackToken(),
	},
	corsOrigins: getRequiredCorsOrigins(),
	executionClient: createGeneratorExecutionClient(generatorBaseUrl, {
		internalToken: getGeneratorInternalToken(),
	}),
	generatorBaseUrl,
	getSession: getRequestSession,
	loggerImpl: console,
	loraReadRepository,
	personsApiBaseUrl: env.PERSONS_API_URL,
	repository,
	s3Config: resolveS3StorageConfig(process.env),
});

ensureDevUser();

export default {
	port: PORT,
	fetch: app.fetch,
};
