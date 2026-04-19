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
 *   - Dataset builder: `availableModels` собирается из реестра адаптеров,
 *     активный `model` — из dataset-builder-settings (Redis), резолвится
 *     роутом и приходит как `datasetEditorModelId`.
 */

import type {
	AdminSettingsSnapshot,
	AdminWorkerHealthStatus,
	PromptEnhanceSettingsBundle,
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
	DATASET_EDITOR_MODEL_DESCRIPTORS,
	DEFAULT_DATASET_EDITOR_MODEL_ID,
} from "@/providers/dataset-editor-models";
import {
	DEFAULT_DATASET_POLL_MS,
	DEFAULT_DATASET_TIMEOUT_MS,
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
	RUNPOD_POD_BOOTSTRAP_URL?: string | null;
	RUNPOD_POD_GPU_TYPE_IDS?: string | null;
	RUNPOD_POD_IMAGE_NAME?: string | null;
	RUNPOD_POD_TEMPLATE_ID?: string | null;
	RUNPOD_TRAINING_MODE?: "serverless" | "pod" | null;
}

export interface BuildAdminSettingsSnapshotInput {
	/** Resolved availability based on gateway-local env (used as fallback). */
	availability: TrainingProviderAvailability[];
	currentTrainingProvider: TrainingProviderName;
	/**
	 * Активный editor model id из dataset-builder-settings (Redis). Если не
	 * передан — используется дефолт. Передаётся отдельным аргументом, а не
	 * читается здесь, чтобы builder остался чистой функцией без сайд-эффектов.
	 */
	datasetEditorModelId?: string;
	env: AdminSettingsEnvSnapshot;
	/**
	 * Per-target prompt-enhance settings. Studio and persons own independent
	 * provider/model selections so they can run on different LLMs without the
	 * admin UI being forced into a single global toggle.
	 */
	promptEnhance?: PromptEnhanceSettingsBundle;
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

function buildDatasetBuilderSection(
	editorModelId: string | undefined
): AdminSettingsSnapshot["datasetBuilder"] {
	return {
		availableModels: DATASET_EDITOR_MODEL_DESCRIPTORS.map((d) => ({
			description: d.description,
			id: d.id,
			label: d.label,
			supportsNegativePrompt: d.supportsNegativePrompt,
		})),
		model: editorModelId ?? DEFAULT_DATASET_EDITOR_MODEL_ID,
		negativePromptPreview: IDENTITY_NEGATIVE_PROMPT,
		note: "Editor model для генерации синтетических вариаций референса. Меняется без рестарта воркера — применится к следующему job-у.",
		pollMs: DEFAULT_DATASET_POLL_MS,
		timeoutMs: DEFAULT_DATASET_TIMEOUT_MS,
	};
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

function resolvePromptEnhanceBundle(
	provided: PromptEnhanceSettingsBundle | undefined
): PromptEnhanceSettingsBundle {
	if (provided) {
		return provided;
	}
	const fallbackEntry = {
		grokConfigured: false,
		openRouterConfigured: false,
		openRouterModel: "openai/gpt-4o-mini",
		openRouterModelEnvDefault: "openai/gpt-4o-mini",
		provider: "grok" as const,
	};
	return {
		persons: { ...fallbackEntry, target: "persons" },
		studio: { ...fallbackEntry, target: "studio" },
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

	const promptEnhance = resolvePromptEnhanceBundle(input.promptEnhance);

	return {
		datasetBuilder: buildDatasetBuilderSection(input.datasetEditorModelId),
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
		promptEnhance,
		runpodTraining: {
			baseModel: runpodBaseModel,
			bootstrapUrl:
				workerSnapshot?.runpod.bootstrapUrl ??
				input.env.RUNPOD_POD_BOOTSTRAP_URL ??
				null,
			endpointConfigured: Boolean(runpodEndpoint),
			endpointId: runpodEndpoint,
			mode:
				workerSnapshot?.runpod.mode ?? input.env.RUNPOD_TRAINING_MODE ?? "pod",
			podGpuTypeIds:
				workerSnapshot?.runpod.podGpuTypeIds ??
				(input.env.RUNPOD_POD_GPU_TYPE_IDS
					? input.env.RUNPOD_POD_GPU_TYPE_IDS.split(",")
							.map((id) => id.trim())
							.filter((id) => id.length > 0)
					: []),
			podImageName:
				workerSnapshot?.runpod.podImageName ??
				input.env.RUNPOD_POD_IMAGE_NAME ??
				null,
			podTemplateId:
				workerSnapshot?.runpod.podTemplateId ??
				input.env.RUNPOD_POD_TEMPLATE_ID ??
				null,
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
