import { setTimeout as sleep } from "node:timers/promises";

import { env, getKafkaEventBusConfig } from "@generator/env/server";
import {
	createKafkaEventConsumer,
	createKafkaEventPublisher,
	eventTopics,
} from "@generator/events";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import {
	createAdminTrainingClient,
	createKafkaAdminTrainingClient,
} from "@/clients/admin-training";
import { PersonsService } from "@/domain/persons";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const RECONCILE_INTERVAL_MS = env.RECONCILE_INTERVAL_MS;
const RECONCILE_WATCH = env.RECONCILE_WATCH;
const kafkaConfig = getKafkaEventBusConfig("persons-worker");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "persons-worker" })
	: null;

const repository = createDrizzlePersonsRepository();
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createGeneratorExecutionClient(env.PERSONS_OPERATOR_URL, {
			internalToken: env.GENERATOR_INTERNAL_TOKEN,
		})
	: undefined;
const adminTrainingHttpClient = env.PERSONS_ADMIN_URL
	? createAdminTrainingClient(env.PERSONS_ADMIN_URL, env.TRAINING_CONTROL_TOKEN)
	: undefined;
const adminTrainingClient = eventPublisher
	? createKafkaAdminTrainingClient(eventPublisher, adminTrainingHttpClient)
	: adminTrainingHttpClient;

if (!(operatorServerClient || kafkaConfig)) {
	throw new Error(
		"PERSONS_OPERATOR_URL or KAFKA_BROKERS is required for the persons worker"
	);
}

const service = new PersonsService({
	adminTrainingClient,
	operatorServerClient,
	repository,
});

const eventConsumer = kafkaConfig
	? await createKafkaEventConsumer({
			config: kafkaConfig,
			groupId: "persons-worker",
			handlers: {
				onGeneratorExecutionUpdated: async (event) => {
					await service.applyExecutionCallback(event.data);
				},
				onPersonLoraTrainingUpdated: async (event) => {
					await service.applyLoraTrainingEvent(event.data);
				},
			},
			logger: console,
			topics: [
				eventTopics.generatorExecutionUpdates,
				eventTopics.personLoraTrainingUpdates,
			],
		})
	: null;

let isShuttingDown = false;

const shutdown = () => {
	isShuttingDown = true;
	eventConsumer?.close().catch((error) => {
		console.error("persons.events.shutdown.error", {
			message: error instanceof Error ? error.message : "unknown",
		});
	});
	eventPublisher?.close().catch((error) => {
		console.error("persons.events-publisher.shutdown.error", {
			message: error instanceof Error ? error.message : "unknown",
		});
	});
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

do {
	try {
		await service.reconcileQueuedGenerations();
	} catch (error) {
		console.error("persons.reconcile.error", {
			message: error instanceof Error ? error.message : "unknown",
		});
	}
	if (RECONCILE_WATCH && !isShuttingDown) {
		await sleep(RECONCILE_INTERVAL_MS);
	}
} while (RECONCILE_WATCH && !isShuttingDown);
