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
	getKafkaEventBusConfig,
	getRequiredCorsOrigins,
} from "@generator/env/server";
import { createKafkaEventConsumer, eventTopics } from "@generator/events";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { resolveS3StorageConfig } from "@generator/storage";
import { createApp } from "@/app";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const PORT = Number(process.env.PORT ?? 3006);

const generatorBaseUrl = getGeneratorApiUrl();
const repository = createDrizzleStudioRepository();
const loraReadRepository = createLoraReadRepository();

const { app, service } = createApp({
	adminApiBaseUrl: env.ADMIN_API_URL,
	adminInternalToken: env.TRAINING_CONTROL_TOKEN,
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
	internalToken: getGeneratorInternalToken(),
	loggerImpl: console,
	loraReadRepository,
	personsApiBaseUrl: env.PERSONS_API_URL,
	repository,
	s3Config: resolveS3StorageConfig(process.env),
});

ensureDevUser();

// Kafka consumer внутри web-instance: подписан на generator.execution.updates.v1
// другой group-id, чтобы не отбирать события у studio-worker (он отвечает за
// персистентность). Здесь мы только пушим обновления в локальный
// RunUpdatesEmitter — это даёт каждому web-pod'у real-time SSE без записи в БД.
//
// ВНИМАНИЕ: каждый pod должен иметь СВОЙ уникальный group-id, иначе Kafka будет
// раздавать события только одному pod'у на партицию, и SSE-клиенты на других
// pod'ах не получат push. Используем INSTANCE_ID/HOSTNAME как суффикс.
const kafkaConfig = getKafkaEventBusConfig("studio-web");
const instanceSuffix =
	process.env.STUDIO_WEB_INSTANCE_ID ??
	process.env.HOSTNAME ??
	`${process.pid}-${Date.now()}`;
const eventConsumer = kafkaConfig
	? await createKafkaEventConsumer({
			config: kafkaConfig,
			groupId: `studio-web-stream-${instanceSuffix}`,
			handlers: {
				onGeneratorExecutionUpdated: async (event) => {
					await service.processStreamEvent(event.data);
				},
			},
			logger: console,
			topics: [eventTopics.generatorExecutionUpdates],
		})
	: null;

const handleSignal = () => {
	eventConsumer?.close().catch((error) => {
		console.error("studio.web.events.shutdown.error", {
			message: error instanceof Error ? error.message : "unknown",
		});
	});
};
process.on("SIGTERM", handleSignal);
process.on("SIGINT", handleSignal);

export default {
	port: PORT,
	fetch: app.fetch,
};
