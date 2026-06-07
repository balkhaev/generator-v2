import type { TrainingProviderAvailability } from "@generator/contracts/admin";

interface TrainingProviderEnvSnapshot {
	RUNPOD_AI_TOOLKIT_ENDPOINT_ID?: string | null;
	RUNPOD_API_KEY?: string | null;
	RUNPOD_POD_BOOTSTRAP_URL?: string | null;
	RUNPOD_TRAINING_MODE?: "serverless" | "pod" | null;
}

/**
 * Считает, какие провайдеры тренировки можно реально включить из UI. Если у
 * провайдера нет нужных секретов — UI оставит его задизейбленным и подскажет,
 * какой env не хватает.
 *
 * RunPod requires разные секреты в зависимости от RUNPOD_TRAINING_MODE:
 *   - serverless: RUNPOD_API_KEY + RUNPOD_AI_TOOLKIT_ENDPOINT_ID
 *   - pod:        RUNPOD_API_KEY + RUNPOD_POD_BOOTSTRAP_URL
 */
export function resolveTrainingProviderAvailability(
	env: TrainingProviderEnvSnapshot
): TrainingProviderAvailability[] {
	const mode = env.RUNPOD_TRAINING_MODE ?? "pod";
	const runpodMissing: string[] = [];
	if (!env.RUNPOD_API_KEY) {
		runpodMissing.push("RUNPOD_API_KEY");
	}
	if (mode === "serverless" && !env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID) {
		runpodMissing.push("RUNPOD_AI_TOOLKIT_ENDPOINT_ID");
	}
	if (mode === "pod" && !env.RUNPOD_POD_BOOTSTRAP_URL) {
		runpodMissing.push("RUNPOD_POD_BOOTSTRAP_URL");
	}

	return [
		{
			configured: runpodMissing.length === 0,
			missing: runpodMissing,
			provider: "runpod",
		},
	];
}
