import { setTimeout as sleep } from "node:timers/promises";
import { getGeneratorApiUrl } from "@generator/env/server";
import { createGeneratorExecutionClient } from "@generator/generator-client-server";

import { StudioService } from "@/domain/studio";
import { createDrizzleStudioRepository } from "@/repositories/studio";

const RECONCILE_INTERVAL_MS = Number(
	process.env.RECONCILE_INTERVAL_MS ?? "5000"
);
const RECONCILE_WATCH = process.env.RECONCILE_WATCH === "true";

const service = new StudioService(
	createDrizzleStudioRepository(),
	createGeneratorExecutionClient(getGeneratorApiUrl()),
	console
);

const shutdown = () => process.exit(0);
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
	if (RECONCILE_WATCH) {
		await sleep(RECONCILE_INTERVAL_MS);
	}
} while (RECONCILE_WATCH);
