import { setTimeout as sleep } from "node:timers/promises";

import { env } from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";
import { PersonsService } from "@/domain/persons";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const RECONCILE_INTERVAL_MS = env.RECONCILE_INTERVAL_MS;
const RECONCILE_WATCH = env.RECONCILE_WATCH;

const repository = createDrizzlePersonsRepository();
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createGeneratorExecutionClient(env.PERSONS_OPERATOR_URL, {
			internalToken: env.GENERATOR_INTERNAL_TOKEN,
		})
	: undefined;

if (!operatorServerClient) {
	throw new Error(
		"PERSONS_OPERATOR_URL is required for the persons reconciler"
	);
}

const service = new PersonsService(repository, operatorServerClient);

let isShuttingDown = false;

const shutdown = () => {
	isShuttingDown = true;
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
