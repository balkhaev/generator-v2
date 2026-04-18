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

async function tryImportToPerson(
	run: ScenarioRunRecord,
	asset: StudioMediaAsset
): Promise<boolean> {
	if (!(run.inputPersonId && run.providerJobId)) {
		return false;
	}
	try {
		await importGenerationToPerson(run.inputPersonId, {
			prompt: run.scenarioName,
			providerEndpointId: run.providerEndpointId ?? undefined,
			providerJobId: run.providerJobId,
			title: `${run.scenarioName} · ${asset.label}`,
			workflowKey: run.workflowKey,
		});
		return true;
	} catch (error) {
		toast.warning(
			error instanceof Error
				? `Shot saved, but person import failed: ${error.message}`
				: "Shot saved, but person import failed."
		);
		return false;
	}
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
				const result = await saveStudioShot({
					artifactKind: asset.mediaType,
					artifactUrl: asset.url,
					runId: asset.runId,
				});
				setSnapshot((current) => ({
					...current,
					shots: [result.data, ...current.shots],
				}));

				const personImported = await tryImportToPerson(run, asset);
				toast.success(
					personImported ? "Shot saved and added to person." : "Shot saved."
				);
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
