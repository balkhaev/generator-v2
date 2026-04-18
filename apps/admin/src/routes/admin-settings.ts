import type { PromptEnhanceSettingsSnapshot } from "@generator/contracts/admin";
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
		openRouterModelEnvDefault: string;
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

		let promptEnhance: PromptEnhanceSettingsSnapshot | undefined;
		if (deps.promptEnhanceSettings && deps.promptEnhanceEnv) {
			const [promptProvider, openRouterModel] = await Promise.all([
				deps.promptEnhanceSettings.getProvider(),
				deps.promptEnhanceSettings.getOpenRouterModel(),
			]);
			promptEnhance = {
				...deps.promptEnhanceEnv,
				openRouterModel,
				provider: promptProvider,
			};
		}

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
