import { Hono } from "hono";

import {
	type BuildAdminSettingsSnapshotInput,
	buildAdminSettingsSnapshot,
} from "@/domain/admin-settings";
import type { TrainingProviderSettings } from "@/domain/training-provider-settings";
import type { WorkerSettingsReader } from "@/domain/worker-settings-store";
import type { TrainingProviderAvailabilityResolver } from "@/routes/training-provider";

export interface AdminSettingsEnvResolver {
	resolve(): BuildAdminSettingsSnapshotInput["env"];
}

export function createAdminSettingsRoutes(deps: {
	availability: TrainingProviderAvailabilityResolver;
	envResolver: AdminSettingsEnvResolver;
	settings: TrainingProviderSettings;
	workerSettingsReader?: WorkerSettingsReader;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		const [provider, workerSnapshot] = await Promise.all([
			deps.settings.getProvider(),
			deps.workerSettingsReader?.read() ?? Promise.resolve(null),
		]);
		const snapshot = buildAdminSettingsSnapshot({
			availability: deps.availability.resolve(),
			currentTrainingProvider: provider,
			env: deps.envResolver.resolve(),
			workerSnapshot,
		});
		return c.json(snapshot);
	});

	return app;
}
