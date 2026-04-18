import { Hono } from "hono";

import {
	type BuildAdminSettingsSnapshotInput,
	buildAdminSettingsSnapshot,
} from "@/domain/admin-settings";
import type { TrainingProviderSettings } from "@/domain/training-provider-settings";
import type { TrainingProviderAvailabilityResolver } from "@/routes/training-provider";

export interface AdminSettingsEnvResolver {
	resolve(): BuildAdminSettingsSnapshotInput["env"];
}

export function createAdminSettingsRoutes(deps: {
	availability: TrainingProviderAvailabilityResolver;
	envResolver: AdminSettingsEnvResolver;
	settings: TrainingProviderSettings;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		const [provider] = await Promise.all([deps.settings.getProvider()]);
		const snapshot = buildAdminSettingsSnapshot({
			availability: deps.availability.resolve(),
			currentTrainingProvider: provider,
			env: deps.envResolver.resolve(),
		});
		return c.json(snapshot);
	});

	return app;
}
