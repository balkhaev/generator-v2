/**
 * Сводный снапшот всех runtime-параметров инференса, которые админка
 * показывает на странице /settings. Делится на две группы:
 *
 *   - Изменяемые в runtime (Redis): training provider.
 *   - Read-only (хардкод/env): остальные карточки. UI их выводит для прозрачности
 *     с подсказкой «Set in env» или «Configured in code», чтобы оператор
 *     понимал, откуда взять рычаги.
 */

import type {
	AdminSettingsSnapshot,
	TrainingProviderAvailability,
	TrainingProviderName,
} from "@generator/contracts/admin";
import { PERSONS_AVATAR_WORKFLOWS } from "@generator/contracts/persons";

import {
	DEFAULT_DATASET_POLL_MS,
	DEFAULT_DATASET_TIMEOUT_MS,
	FLUX_REFERENCE_EDIT_MODEL,
	IDENTITY_GUIDANCE_SCALE,
	IDENTITY_NEGATIVE_PROMPT,
} from "@/providers/lora-dataset-builder";

interface AdminSettingsEnvSnapshot {
	PERSONS_DEFAULT_AVATAR_WORKFLOW?: string | null;
	PERSONS_DEFAULT_LORA_WORKFLOW?: string | null;
	RECONCILE_INTERVAL_MS?: number | null;
	RECONCILE_WATCH?: boolean | null;
	RUNPOD_AI_TOOLKIT_BASE_MODEL?: string | null;
	RUNPOD_AI_TOOLKIT_ENDPOINT_ID?: string | null;
	RUNPOD_AI_TOOLKIT_POLL_MS?: number | null;
	RUNPOD_AI_TOOLKIT_TIMEOUT_MS?: number | null;
}

export interface BuildAdminSettingsSnapshotInput {
	availability: TrainingProviderAvailability[];
	currentTrainingProvider: TrainingProviderName;
	env: AdminSettingsEnvSnapshot;
}

export function buildAdminSettingsSnapshot(
	input: BuildAdminSettingsSnapshotInput
): AdminSettingsSnapshot {
	return {
		datasetBuilder: {
			guidanceScale: IDENTITY_GUIDANCE_SCALE,
			model: FLUX_REFERENCE_EDIT_MODEL,
			negativePromptPreview: IDENTITY_NEGATIVE_PROMPT,
			note: "Configured in apps/admin/src/providers/lora-dataset-builder.ts. Edit code to change.",
			pollMs: DEFAULT_DATASET_POLL_MS,
			timeoutMs: DEFAULT_DATASET_TIMEOUT_MS,
		},
		generatorRuntime: {
			reconcileIntervalMs: input.env.RECONCILE_INTERVAL_MS ?? 5000,
			reconcileWatch: input.env.RECONCILE_WATCH ?? true,
		},
		personsDefaults: {
			avatarPreviewWorkflow: PERSONS_AVATAR_WORKFLOWS.preview,
			avatarRefineWorkflow: PERSONS_AVATAR_WORKFLOWS.refine,
			avatarWorkflow:
				input.env.PERSONS_DEFAULT_AVATAR_WORKFLOW ?? "fal-zimage-turbo",
			loraWorkflow:
				input.env.PERSONS_DEFAULT_LORA_WORKFLOW ?? "fal-zimage-turbo",
		},
		runpodTraining: {
			baseModel: input.env.RUNPOD_AI_TOOLKIT_BASE_MODEL ?? "z-image",
			endpointConfigured: Boolean(input.env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID),
			endpointId: input.env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID ?? null,
			pollMs: input.env.RUNPOD_AI_TOOLKIT_POLL_MS ?? 30_000,
			timeoutMs: input.env.RUNPOD_AI_TOOLKIT_TIMEOUT_MS ?? 120 * 60 * 1000,
		},
		trainingProvider: {
			availability: input.availability,
			provider: input.currentTrainingProvider,
		},
	};
}
