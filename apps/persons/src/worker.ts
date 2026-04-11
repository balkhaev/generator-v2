import { setTimeout as sleep } from "node:timers/promises";

import { createOperatorServerClient } from "@/clients/operator-server";
import { PersonsService } from "@/domain/persons";
import { env } from "@/env";
import { createDrizzlePersonsRepository } from "@/repositories/persons";

const RECONCILE_INTERVAL_MS = Number(
	process.env.RECONCILE_INTERVAL_MS ?? "5000"
);
const RECONCILE_WATCH = process.env.RECONCILE_WATCH === "true";

const repository = createDrizzlePersonsRepository();
const operatorServerClient = env.PERSONS_OPERATOR_URL
	? createOperatorServerClient(env.PERSONS_OPERATOR_URL)
	: undefined;

if (!operatorServerClient) {
	throw new Error(
		"PERSONS_OPERATOR_URL is required for the persons reconciler"
	);
}

const service = new PersonsService(repository, operatorServerClient);

do {
	await service.reconcileQueuedGenerations();
	if (RECONCILE_WATCH) {
		await sleep(RECONCILE_INTERVAL_MS);
	}
} while (RECONCILE_WATCH);
