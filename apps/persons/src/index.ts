import { auth, ensureDevUser } from "@generator/auth";
import { getCorsOrigins } from "@generator/env/server";
import { createApp } from "@/app";
import { createAdminTrainingClient } from "@/clients/admin-training";
import { createOperatorServerClient } from "@/clients/operator-server";
import { env } from "@/env";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const repository = createDrizzlePersonsRepository();
const adminTrainingClient = env.PERSONS_ADMIN_URL
	? createAdminTrainingClient(env.PERSONS_ADMIN_URL, env.TRAINING_CONTROL_TOKEN)
	: undefined;
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createOperatorServerClient(env.PERSONS_OPERATOR_URL, {
			internalToken: env.GENERATOR_INTERNAL_TOKEN,
		})
	: undefined;

const corsOrigins = getCorsOrigins();

const app = createApp({
	adminTrainingClient,
	authHandler: (request) => auth.handler(request),
	callbackConfig: {
		token: env.GENERATOR_CALLBACK_TOKEN,
		url: `${env.PERSONS_BASE_URL ?? `http://localhost:${env.PORT}`}/api/internal/generator-executions`,
	},
	corsOrigins: corsOrigins.length > 0 ? corsOrigins : [env.CORS_ORIGIN],
	getSession: (request) => auth.api.getSession({ headers: request.headers }),
	operatorServerClient,
	repository,
});

ensureDevUser();

export default {
	port: env.PORT,
	fetch: app.fetch,
};
