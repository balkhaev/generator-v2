import { setTimeout as sleep } from "node:timers/promises";
import { env, getGeneratorApiUrl } from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";

import { StudioService } from "@/domain/studio";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const RECONCILE_INTERVAL_MS = env.RECONCILE_INTERVAL_MS;
const RECONCILE_WATCH = env.RECONCILE_WATCH;

const service = new StudioService(
	createDrizzleStudioRepository(),
	createGeneratorExecutionClient(getGeneratorApiUrl()),
	console
);

let isShuttingDown = false;

const shutdown = () => {
	isShuttingDown = true;
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

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
