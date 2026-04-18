import { describe, expect, test } from "bun:test";

import { buildAdminSettingsSnapshot } from "@/domain/admin-settings";

describe("buildAdminSettingsSnapshot", () => {
	test("includes both training providers in availability and current selection", () => {
		const snapshot = buildAdminSettingsSnapshot({
			availability: [
				{ configured: true, missing: [], provider: "fal" },
				{
					configured: false,
					missing: ["RUNPOD_API_KEY"],
					provider: "runpod",
				},
			],
			currentTrainingProvider: "fal",
			env: {},
		});

		expect(snapshot.trainingProvider.provider).toBe("fal");
		expect(snapshot.trainingProvider.availability).toHaveLength(2);
		expect(snapshot.runpodTraining.endpointConfigured).toBe(false);
		expect(snapshot.runpodTraining.baseModel).toBe("z-image");
	});

	test("surfaces persons defaults from env with safe fallbacks", () => {
		const snapshot = buildAdminSettingsSnapshot({
			availability: [{ configured: true, missing: [], provider: "fal" }],
			currentTrainingProvider: "fal",
			env: {
				PERSONS_DEFAULT_AVATAR_WORKFLOW: "fal-flux2-turbo",
				PERSONS_DEFAULT_LORA_WORKFLOW: "fal-zimage-turbo-lora",
				RECONCILE_INTERVAL_MS: 7000,
				RECONCILE_WATCH: false,
			},
		});

		expect(snapshot.personsDefaults.avatarWorkflow).toBe("fal-flux2-turbo");
		expect(snapshot.personsDefaults.loraWorkflow).toBe("fal-zimage-turbo-lora");
		expect(snapshot.personsDefaults.avatarPreviewWorkflow).toBe(
			"fal-flux2-turbo"
		);
		expect(snapshot.personsDefaults.avatarRefineWorkflow).toBe(
			"fal-flux2-dev-edit"
		);
		expect(snapshot.generatorRuntime.reconcileIntervalMs).toBe(7000);
		expect(snapshot.generatorRuntime.reconcileWatch).toBe(false);
	});

	test("dataset builder section reports the canonical model", () => {
		const snapshot = buildAdminSettingsSnapshot({
			availability: [],
			currentTrainingProvider: "fal",
			env: {},
		});

		expect(snapshot.datasetBuilder.model).toBe("fal-ai/flux-2/edit");
		expect(snapshot.datasetBuilder.guidanceScale).toBeGreaterThan(0);
		expect(snapshot.datasetBuilder.note).toContain("lora-dataset-builder.ts");
	});
});
