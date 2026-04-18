import type { TrainingProviderAvailability } from "@generator/contracts/admin";

interface TrainingProviderEnvSnapshot {
	FAL_KEY?: string | null;
	RUNPOD_AI_TOOLKIT_ENDPOINT_ID?: string | null;
	RUNPOD_API_KEY?: string | null;
}

/**
 * Считает, какие провайдеры тренировки можно реально включить из UI. Если у
 * провайдера нет нужных секретов — UI оставит его задизейбленным и подскажет,
 * какой env не хватает.
 */
export function resolveTrainingProviderAvailability(
	env: TrainingProviderEnvSnapshot
): TrainingProviderAvailability[] {
	const falMissing: string[] = [];
	if (!env.FAL_KEY) {
		falMissing.push("FAL_KEY");
	}

	const runpodMissing: string[] = [];
	if (!env.RUNPOD_API_KEY) {
		runpodMissing.push("RUNPOD_API_KEY");
	}
	if (!env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID) {
		runpodMissing.push("RUNPOD_AI_TOOLKIT_ENDPOINT_ID");
	}

	return [
		{
			configured: falMissing.length === 0,
			missing: falMissing,
			provider: "fal",
		},
		{
			configured: runpodMissing.length === 0,
			missing: runpodMissing,
			provider: "runpod",
		},
	];
}
