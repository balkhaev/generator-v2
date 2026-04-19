import type {
	PromptEnhanceSettingsBundle,
	PromptEnhanceTarget,
} from "@generator/contracts/admin";
import { Hono } from "hono";

import {
	type BuildAdminSettingsSnapshotInput,
	buildAdminSettingsSnapshot,
} from "@/domain/admin-settings";
import type { DatasetBuilderSettings } from "@/domain/dataset-builder-settings";
import type { PromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import type { TrainingProviderSettings } from "@/domain/training-provider-settings";
import type { WorkerSettingsReader } from "@/domain/worker-settings-store";
import type { TrainingProviderAvailabilityResolver } from "@/routes/training-provider";

export interface AdminSettingsEnvResolver {
	resolve(): BuildAdminSettingsSnapshotInput["env"];
}

interface PerTargetEnv {
	grokConfigured: boolean;
	openRouterConfigured: boolean;
	openRouterModelEnvDefault: string;
}

const TARGETS: PromptEnhanceTarget[] = ["studio", "persons"];

export function createAdminSettingsRoutes(deps: {
	availability: TrainingProviderAvailabilityResolver;
	datasetBuilderSettings?: DatasetBuilderSettings;
	envResolver: AdminSettingsEnvResolver;
	promptEnhanceEnvByTarget?: Record<PromptEnhanceTarget, PerTargetEnv>;
	promptEnhanceSettings?: PromptEnhanceSettings;
	settings: TrainingProviderSettings;
	workerSettingsReader?: WorkerSettingsReader;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		const [trainingProvider, workerSnapshot, datasetEditorModelId] =
			await Promise.all([
				deps.settings.getProvider(),
				deps.workerSettingsReader?.read() ?? Promise.resolve(null),
				deps.datasetBuilderSettings?.getEditorModelId() ??
					Promise.resolve(undefined),
			]);

		let promptEnhance: PromptEnhanceSettingsBundle | undefined;
		if (deps.promptEnhanceSettings && deps.promptEnhanceEnvByTarget) {
			const settings = deps.promptEnhanceSettings;
			const envByTarget = deps.promptEnhanceEnvByTarget;
			const snapshots = await Promise.all(
				TARGETS.map(async (target) => {
					const [provider, openRouterModel] = await Promise.all([
						settings.getProvider(target),
						settings.getOpenRouterModel(target),
					]);
					return [
						target,
						{
							...envByTarget[target],
							openRouterModel,
							provider,
							target,
						},
					] as const;
				})
			);
			const bundle = Object.fromEntries(snapshots) as Record<
				PromptEnhanceTarget,
				PromptEnhanceSettingsBundle["persons"]
			>;
			promptEnhance = {
				persons: bundle.persons,
				studio: bundle.studio,
			};
		}

		const snapshot = buildAdminSettingsSnapshot({
			availability: deps.availability.resolve(),
			currentTrainingProvider: trainingProvider,
			...(datasetEditorModelId ? { datasetEditorModelId } : {}),
			env: deps.envResolver.resolve(),
			...(promptEnhance ? { promptEnhance } : {}),
			workerSnapshot,
		});
		return c.json(snapshot);
	});

	return app;
}
