import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
} from "@generator/auth";
import { env, getCorsOrigins } from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { createApp } from "@/app";
import { createAdminLoraClient } from "@/clients/admin-loras";
import { createAdminTrainingClient } from "@/clients/admin-training";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const PORT = Number(process.env.PORT ?? 3003);

const repository = createDrizzlePersonsRepository();
const adminTrainingClient = env.PERSONS_ADMIN_URL
	? createAdminTrainingClient(env.PERSONS_ADMIN_URL, env.TRAINING_CONTROL_TOKEN)
	: undefined;
const adminLoraClient = env.PERSONS_ADMIN_URL
	? createAdminLoraClient(env.PERSONS_ADMIN_URL, env.TRAINING_CONTROL_TOKEN)
	: undefined;
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createGeneratorExecutionClient(env.PERSONS_OPERATOR_URL, {
			internalToken: env.GENERATOR_INTERNAL_TOKEN,
		})
	: undefined;

const corsOriginsFromEnv = getCorsOrigins();
const fallbackCorsOrigins = env.CORS_ORIGIN ? [env.CORS_ORIGIN] : [];
const effectiveCorsOrigins =
	corsOriginsFromEnv.length > 0 ? corsOriginsFromEnv : fallbackCorsOrigins;

const app = createApp({
	adminLoraClient,
	adminTrainingClient,
	authHandler: handleAuthRequest,
	callbackConfig: {
		token: env.GENERATOR_CALLBACK_TOKEN,
		url: `${env.PERSONS_BASE_URL ?? `http://localhost:${PORT}`}/api/internal/generator-executions`,
	},
	corsOrigins: effectiveCorsOrigins,
	getSession: getRequestSession,
	operatorServerClient,
	repository,
});

ensureDevUser();

export default {
	port: PORT,
	fetch: app.fetch,
};
