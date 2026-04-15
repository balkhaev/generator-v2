import { setTimeout as sleep } from "node:timers/promises";

import { createOperatorServerClient } from "@/clients/operator-server";
import { PersonsService } from "@/domain/persons";
import { env } from "@/env";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const RECONCILE_INTERVAL_MS = Number(
	process.env.RECONCILE_INTERVAL_MS ?? "5000"
);
const RECONCILE_WATCH = process.env.RECONCILE_WATCH !== "false";

const repository = createDrizzlePersonsRepository();
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createOperatorServerClient(env.PERSONS_OPERATOR_URL, {
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
