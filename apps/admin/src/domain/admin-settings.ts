/**
 * Сводный снапшот всех runtime-параметров инференса, которые админка
 * показывает на странице /settings.
 *
 * Источники истины:
 *   - Training availability и runpod endpoint берутся из снапшота воркера в
 *     Redis (см. worker-settings-store.ts), потому что секреты живут только у
 *     admin-worker. Если снапшот свежий — UI видит реальный статус. Если нет —
 *     fallback на локальный env гейтвея + предупреждение через `workerHealth`.
 *   - Persons defaults и generator runtime читаются из env гейтвея (там они
 *     обычно прокинуты для сетевого доступа).
 *   - Dataset builder зашит в коде (общая хардкод-конфигурация для пайплайна).
 */

import type {
	AdminSettingsSnapshot,
	AdminWorkerHealthStatus,
	TrainingProviderAvailability,
	TrainingProviderName,
} from "@generator/contracts/admin";
import { PERSONS_AVATAR_WORKFLOWS } from "@generator/contracts/persons";
import {
	isWorkerSnapshotFresh,
	snapshotAgeSeconds,
	type WorkerSettingsSnapshot,
} from "@/domain/worker-settings-store";
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
	/** Resolved availability based on gateway-local env (used as fallback). */
	availability: TrainingProviderAvailability[];
	currentTrainingProvider: TrainingProviderName;
	env: AdminSettingsEnvSnapshot;
	/** Optional snapshot from the worker; when fresh, takes precedence. */
	workerSnapshot?: WorkerSettingsSnapshot | null;
}

const PLACEHOLDER_ENDPOINT_VALUES = new Set([
	"",
	"REPLACE_AFTER_DEPLOY",
	"PLACEHOLDER",
]);

function normalizeEndpointId(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (PLACEHOLDER_ENDPOINT_VALUES.has(trimmed.toUpperCase())) {
		return null;
	}
	return trimmed;
}

function buildWorkerHealth(
	workerSnapshot: WorkerSettingsSnapshot | null | undefined,
	now: () => number = Date.now
): AdminWorkerHealthStatus {
	const fresh = isWorkerSnapshotFresh(workerSnapshot ?? null, undefined, now);
	return {
		ageSeconds: snapshotAgeSeconds(workerSnapshot ?? null, now),
		isFresh: fresh,
		lastSeenAt: workerSnapshot?.publishedAt ?? null,
		source: fresh ? "worker" : "gateway-fallback",
	};
}

export function buildAdminSettingsSnapshot(
	input: BuildAdminSettingsSnapshotInput
): AdminSettingsSnapshot {
	const workerHealth = buildWorkerHealth(input.workerSnapshot ?? null);
	const useWorker = workerHealth.isFresh && Boolean(input.workerSnapshot);
	const workerSnapshot = useWorker ? input.workerSnapshot : null;

	const availability = workerSnapshot?.availability ?? input.availability;

	const runpodEndpointFromWorker = workerSnapshot
		? normalizeEndpointId(workerSnapshot.runpod.endpointId)
		: null;
	const runpodEndpointFromEnv = normalizeEndpointId(
		input.env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID
	);
	const runpodEndpoint = runpodEndpointFromWorker ?? runpodEndpointFromEnv;

	const runpodBaseModel =
		workerSnapshot?.runpod.baseModel ??
		input.env.RUNPOD_AI_TOOLKIT_BASE_MODEL ??
		"z-image";
	const runpodPollMs =
		workerSnapshot?.runpod.pollMs ??
		input.env.RUNPOD_AI_TOOLKIT_POLL_MS ??
		30_000;
	const runpodTimeoutMs =
		workerSnapshot?.runpod.timeoutMs ??
		input.env.RUNPOD_AI_TOOLKIT_TIMEOUT_MS ??
		120 * 60 * 1000;

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
			baseModel: runpodBaseModel,
			endpointConfigured: Boolean(runpodEndpoint),
			endpointId: runpodEndpoint,
			pollMs: runpodPollMs,
			timeoutMs: runpodTimeoutMs,
		},
		trainingProvider: {
			availability,
			provider: input.currentTrainingProvider,
		},
		workerHealth,
	};
}
