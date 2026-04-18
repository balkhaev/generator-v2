import { Hono } from "hono";

import {
	type BuildAdminSettingsSnapshotInput,
	buildAdminSettingsSnapshot,
} from "@/domain/admin-settings";
import type { PromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import type { TrainingProviderSettings } from "@/domain/training-provider-settings";
import type { WorkerSettingsReader } from "@/domain/worker-settings-store";
import type { TrainingProviderAvailabilityResolver } from "@/routes/training-provider";

export interface AdminSettingsEnvResolver {
	resolve(): BuildAdminSettingsSnapshotInput["env"];
}

export function createAdminSettingsRoutes(deps: {
	availability: TrainingProviderAvailabilityResolver;
	envResolver: AdminSettingsEnvResolver;
	promptEnhanceEnv?: {
		grokConfigured: boolean;
		openRouterConfigured: boolean;
		openRouterModel: string;
	};
	promptEnhanceSettings?: PromptEnhanceSettings;
	settings: TrainingProviderSettings;
	workerSettingsReader?: WorkerSettingsReader;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		const [trainingProvider, workerSnapshot] = await Promise.all([
			deps.settings.getProvider(),
			deps.workerSettingsReader?.read() ?? Promise.resolve(null),
		]);

		const promptEnhance =
			deps.promptEnhanceSettings && deps.promptEnhanceEnv
				? {
						...deps.promptEnhanceEnv,
						provider: await deps.promptEnhanceSettings.getProvider(),
					}
				: undefined;

		const snapshot = buildAdminSettingsSnapshot({
			availability: deps.availability.resolve(),
			currentTrainingProvider: trainingProvider,
			env: deps.envResolver.resolve(),
			...(promptEnhance ? { promptEnhance } : {}),
			workerSnapshot,
		});
		return c.json(snapshot);
	});

	return app;
}
