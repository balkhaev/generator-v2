import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
} from "@generator/auth";
import { createLoraReadRepository } from "@generator/db/repositories/lora-read";
import {
	env,
	getCorsOrigins,
	getKafkaEventBusConfig,
} from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { createApp } from "@/app";
import {
	createAdminTrainingClient,
	createKafkaAdminTrainingClient,
} from "@/clients/admin-training";
import { createPersonsPromptEnhanceProxy } from "@/prompt-enhance-resolve";
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
const loraReadRepository = createLoraReadRepository();
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createGeneratorExecutionClient(env.PERSONS_OPERATOR_URL, {
			internalToken: env.GENERATOR_INTERNAL_TOKEN,
		})
	: undefined;
const grokClient = createPersonsPromptEnhanceProxy();

const corsOriginsFromEnv = getCorsOrigins();
const fallbackCorsOrigins = env.CORS_ORIGIN ? [env.CORS_ORIGIN] : [];
const effectiveCorsOrigins =
	corsOriginsFromEnv.length > 0 ? corsOriginsFromEnv : fallbackCorsOrigins;

const app = createApp({
	adminTrainingClient,
	authHandler: handleAuthRequest,
	callbackConfig: {
		token: env.GENERATOR_CALLBACK_TOKEN,
	},
	corsOrigins: effectiveCorsOrigins,
	getSession: getRequestSession,
	grokClient,
	loraReadRepository,
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
