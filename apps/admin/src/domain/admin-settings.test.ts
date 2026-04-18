import { describe, expect, test } from "bun:test";

import { buildAdminSettingsSnapshot } from "@/domain/admin-settings";
import type { WorkerSettingsSnapshot } from "@/domain/worker-settings-store";

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
		expect(snapshot.promptEnhance.provider).toBe("grok");
		expect(snapshot.promptEnhance.openRouterModel).toBe("openai/gpt-4o-mini");
		expect(snapshot.trainingProvider.availability).toHaveLength(2);
		expect(snapshot.runpodTraining.endpointConfigured).toBe(false);
		expect(snapshot.runpodTraining.baseModel).toBe("z-image");
		expect(snapshot.workerHealth.source).toBe("gateway-fallback");
		expect(snapshot.workerHealth.isFresh).toBe(false);
	});

	test("prefers worker snapshot for availability and runpod when fresh", () => {
		const workerSnapshot: WorkerSettingsSnapshot = {
			availability: [
				{ configured: true, missing: [], provider: "fal" },
				{ configured: true, missing: [], provider: "runpod" },
			],
			publishedAt: new Date().toISOString(),
			runpod: {
				baseModel: "z-image",
				bootstrapUrl: null,
				endpointConfigured: true,
				endpointId: "endpoint-abc123",
				mode: "serverless",
				podGpuTypeIds: null,
				podImageName: null,
				podTemplateId: null,
				pollMs: 30_000,
				timeoutMs: 7_200_000,
			},
		};

		const snapshot = buildAdminSettingsSnapshot({
			availability: [
				{
					configured: false,
					missing: ["FAL_KEY"],
					provider: "fal",
				},
				{
					configured: false,
					missing: ["RUNPOD_API_KEY"],
					provider: "runpod",
				},
			],
			currentTrainingProvider: "runpod",
			env: {},
			workerSnapshot,
		});

		expect(
			snapshot.trainingProvider.availability.every((entry) => entry.configured)
		).toBe(true);
		expect(snapshot.runpodTraining.endpointConfigured).toBe(true);
		expect(snapshot.runpodTraining.endpointId).toBe("endpoint-abc123");
		expect(snapshot.workerHealth.source).toBe("worker");
		expect(snapshot.workerHealth.isFresh).toBe(true);
	});

	test("treats stale worker snapshot as fallback and prefers gateway env", () => {
		const staleSnapshot: WorkerSettingsSnapshot = {
			availability: [{ configured: true, missing: [], provider: "fal" }],
			publishedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
			runpod: {
				baseModel: "flux-dev",
				bootstrapUrl: null,
				endpointConfigured: true,
				endpointId: "stale-endpoint",
				mode: "serverless",
				podGpuTypeIds: null,
				podImageName: null,
				podTemplateId: null,
				pollMs: null,
				timeoutMs: null,
			},
		};

		const snapshot = buildAdminSettingsSnapshot({
			availability: [
				{
					configured: false,
					missing: ["FAL_KEY"],
					provider: "fal",
				},
			],
			currentTrainingProvider: "fal",
			env: { RUNPOD_AI_TOOLKIT_BASE_MODEL: "z-image" },
			workerSnapshot: staleSnapshot,
		});

		expect(snapshot.trainingProvider.availability[0]?.configured).toBe(false);
		expect(snapshot.runpodTraining.baseModel).toBe("z-image");
		expect(snapshot.workerHealth.source).toBe("gateway-fallback");
		expect(snapshot.workerHealth.isFresh).toBe(false);
		expect(snapshot.workerHealth.lastSeenAt).toBe(staleSnapshot.publishedAt);
	});

	test("treats placeholder endpoint id as not configured", () => {
		const snapshot = buildAdminSettingsSnapshot({
			availability: [],
			currentTrainingProvider: "fal",
			env: { RUNPOD_AI_TOOLKIT_ENDPOINT_ID: "REPLACE_AFTER_DEPLOY" },
		});
		expect(snapshot.runpodTraining.endpointConfigured).toBe(false);
		expect(snapshot.runpodTraining.endpointId).toBe(null);
	});

	test("surfaces persons defaults from env with safe fallbacks", () => {
		const snapshot = buildAdminSettingsSnapshot({
			availability: [{ configured: true, missing: [], provider: "fal" }],
			currentTrainingProvider: "fal",
			env: {
				PERSONS_DEFAULT_AVATAR_WORKFLOW: "fal-flux2-turbo",
				PERSONS_DEFAULT_LORA_WORKFLOW: "fal-zimage-turbo",
				RECONCILE_INTERVAL_MS: 7000,
				RECONCILE_WATCH: false,
			},
		});

		expect(snapshot.personsDefaults.avatarWorkflow).toBe("fal-flux2-turbo");
		expect(snapshot.personsDefaults.loraWorkflow).toBe("fal-zimage-turbo");
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
