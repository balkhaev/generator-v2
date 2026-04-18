"use client";

import {
	type AdminSnapshot,
	type ScenarioRunRecord,
	saveStudioShot,
} from "@generator/studio-client/client";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { StudioMediaAsset } from "@/components/preview-surface";
import { importGenerationToPerson } from "@/lib/persons-api";

interface UseShotSavingInput {
	runs: ScenarioRunRecord[];
	setSnapshot: (updater: (current: AdminSnapshot) => AdminSnapshot) => void;
}

export function useShotSaving({ runs, setSnapshot }: UseShotSavingInput) {
	const [savingShotAssetId, setSavingShotAssetId] = useState<string | null>(
		null
	);

	const saveShot = useCallback(
		async (asset: StudioMediaAsset) => {
			const run = runs.find((entry) => entry.id === asset.runId);
			if (!run) {
				toast.error("Source run no longer available.");
				return;
			}
			setSavingShotAssetId(asset.id);
			try {
				if (run.inputPersonId) {
					if (!run.providerJobId) {
						toast.error("Run is not finished yet.");
						return;
					}
					await importGenerationToPerson(run.inputPersonId, {
						prompt: run.scenarioName,
						providerEndpointId: run.providerEndpointId ?? undefined,
						providerJobId: run.providerJobId,
						title: `${run.scenarioName} · ${asset.label}`,
						workflowKey: run.workflowKey,
					});
					toast.success("Saved to person.");
				} else {
					const result = await saveStudioShot({
						artifactKind: asset.mediaType,
						artifactUrl: asset.url,
						runId: asset.runId,
					});
					setSnapshot((current) => ({
						...current,
						shots: [result.data, ...current.shots],
					}));
					toast.success("Shot saved.");
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Unable to save shot."
				);
			} finally {
				setSavingShotAssetId(null);
			}
		},
		[runs, setSnapshot]
	);

	return { savingShotAssetId, saveShot };
}
