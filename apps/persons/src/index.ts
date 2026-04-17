import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
} from "@generator/auth";
import {
	env,
	getCorsOrigins,
	getKafkaEventBusConfig,
} from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { createApp } from "@/app";
import { createAdminLoraClient } from "@/clients/admin-loras";
import {
	createAdminTrainingClient,
	createKafkaAdminTrainingClient,
} from "@/clients/admin-training";
import { createGrokClient } from "@/clients/grok";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const PORT = Number(process.env.PORT ?? 3003);
const kafkaConfig = getKafkaEventBusConfig("persons-api");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "persons-api" })
	: null;

const repository = createDrizzlePersonsRepository();
const adminTrainingHttpClient = env.PERSONS_ADMIN_URL
	? createAdminTrainingClient(env.PERSONS_ADMIN_URL, env.TRAINING_CONTROL_TOKEN)
	: undefined;
const adminTrainingClient = eventPublisher
	? createKafkaAdminTrainingClient(eventPublisher, adminTrainingHttpClient)
	: adminTrainingHttpClient;
const adminLoraClient = env.PERSONS_ADMIN_URL
	? createAdminLoraClient(env.PERSONS_ADMIN_URL, env.TRAINING_CONTROL_TOKEN)
	: undefined;
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createGeneratorExecutionClient(env.PERSONS_OPERATOR_URL, {
			internalToken: env.GENERATOR_INTERNAL_TOKEN,
		})
	: undefined;
const grokClient = env.XAI_API_KEY
	? createGrokClient({ apiKey: env.XAI_API_KEY })
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
	},
	corsOrigins: effectiveCorsOrigins,
	getSession: getRequestSession,
	grokClient,
	operatorServerClient,
	repository,
});

ensureDevUser();

if (eventPublisher) {
	const shutdown = () => {
		eventPublisher.close().catch((error) => {
			console.error("persons.events-publisher.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

export default {
	port: PORT,
	fetch: app.fetch,
};
