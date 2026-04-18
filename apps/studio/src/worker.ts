import { setTimeout as sleep } from "node:timers/promises";
import {
	env,
	getGeneratorApiUrl,
	getGeneratorInternalToken,
	getKafkaEventBusConfig,
} from "@generator/env/server";
import { createKafkaEventConsumer, eventTopics } from "@generator/events";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";

import { StudioService } from "@/domain/studio";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const RECONCILE_INTERVAL_MS = env.RECONCILE_INTERVAL_MS;
const RECONCILE_WATCH = env.RECONCILE_WATCH;
const kafkaConfig = getKafkaEventBusConfig("studio-worker");

const service = new StudioService(
	createDrizzleStudioRepository(),
	createGeneratorExecutionClient(getGeneratorApiUrl(), {
		internalToken: getGeneratorInternalToken(),
	}),
	console,
	undefined,
	{
		personsApiBaseUrl: env.PERSONS_API_URL,
	}
);

const eventConsumer = kafkaConfig
	? await createKafkaEventConsumer({
			config: kafkaConfig,
			groupId: "studio-worker",
			handlers: {
				onGeneratorExecutionUpdated: async (event) => {
					await service.applyExecutionCallback(event.data);
				},
			},
			logger: console,
			topics: [eventTopics.generatorExecutionUpdates],
		})
	: null;

let isShuttingDown = false;
let resolveShutdown: (() => void) | null = null;
const shutdownComplete = new Promise<void>((resolve) => {
	resolveShutdown = resolve;
});

const shutdown = async () => {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;
	try {
		await eventConsumer?.close();
	} catch (error) {
		console.error("studio.events.shutdown.error", {
			message: error instanceof Error ? error.message : "unknown",
		});
	} finally {
		resolveShutdown?.();
	}
};

const handleSignal = () => {
	shutdown().catch((error) => {
		console.error("studio.shutdown.error", {
			message: error instanceof Error ? error.message : "unknown",
		});
	});
};

process.on("SIGTERM", handleSignal);
process.on("SIGINT", handleSignal);

do {
	try {
		await service.reconcileActiveRuns();
	} catch (error) {
		console.error("studio.reconcile.error", {
			message: error instanceof Error ? error.message : "unknown",
		});
	}
	if (RECONCILE_WATCH && !isShuttingDown) {
		await sleep(RECONCILE_INTERVAL_MS);
	}
} while (RECONCILE_WATCH && !isShuttingDown);

await shutdownComplete;
