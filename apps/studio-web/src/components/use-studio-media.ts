"use client";

import type { PersonRecord } from "@generator/contracts/persons";
import type { ScenarioRunRecord } from "@generator/studio-client/client";
import { useEffect, useMemo } from "react";

import type { StudioMediaAsset } from "@/components/preview-surface";

interface UseStudioMediaInput {
	buildPersonMediaAssets: (person: PersonRecord) => StudioMediaAsset[];
	buildScenarioMediaAssets: (runs: ScenarioRunRecord[]) => StudioMediaAsset[];
	currentSearch: string;
	isPersonMode: boolean;
	navigate: (href: string) => void;
	pathname: string;
	personDetail: PersonRecord | null;
	requestedAssetId: string | null;
	requestedRunId: string | null;
	runs: ScenarioRunRecord[];
	selectedScenarioId: string | null;
	urlBuilder: (input: {
		assetId?: string | null;
		runId?: string | null;
	}) => string;
}

export function useStudioMedia({
	buildPersonMediaAssets,
	buildScenarioMediaAssets,
	isPersonMode,
	navigate,
	personDetail,
	requestedAssetId,
	requestedRunId,
	runs,
	selectedScenarioId,
	urlBuilder,
}: UseStudioMediaInput) {
	const mediaAssets = useMemo(() => {
		if (isPersonMode && personDetail) {
			return buildPersonMediaAssets(personDetail);
		}
		return buildScenarioMediaAssets(runs);
	}, [
		buildPersonMediaAssets,
		buildScenarioMediaAssets,
		isPersonMode,
		personDetail,
		runs,
	]);

	const selectedScenarioAssets = useMemo(() => {
		if (isPersonMode || !selectedScenarioId) {
			return mediaAssets;
		}
		return mediaAssets.filter(
			(asset) => asset.scenarioId === selectedScenarioId
		);
	}, [isPersonMode, mediaAssets, selectedScenarioId]);

	const selectedMediaIndex = (() => {
		if (selectedScenarioAssets.length === 0) {
			return -1;
		}
		const directIndex = selectedScenarioAssets.findIndex(
			(asset) => asset.id === requestedAssetId
		);
		return directIndex === -1 ? 0 : directIndex;
	})();

	const selectedMediaId =
		selectedMediaIndex === -1
			? null
			: selectedScenarioAssets[selectedMediaIndex].id;
	const selectedMediaAsset =
		selectedMediaIndex === -1
			? null
			: selectedScenarioAssets[selectedMediaIndex];

	useEffect(() => {
		// Не подставляем asset id в URL автоматически: иначе после каждого клика
		// по сценарию (handlePickScenario чистит ?asset) этот эффект делал бы
		// второй router.replace, и Next.js soft-navigation проигрывался дважды
		// — отсюда мерцание всего экрана при переключении.
		// Чистим URL только если в нём остался ссылающийся в никуда asset id.
		if (requestedAssetId === null) {
			return;
		}
		if (requestedAssetId === selectedMediaId) {
			return;
		}
		navigate(
			urlBuilder({
				assetId: null,
				runId: isPersonMode ? null : requestedRunId,
			})
		);
	}, [
		isPersonMode,
		navigate,
		requestedAssetId,
		requestedRunId,
		selectedMediaId,
		urlBuilder,
	]);

	function navigateToMedia(targetIndex: number) {
		if (targetIndex < 0 || targetIndex >= selectedScenarioAssets.length) {
			return;
		}
		navigate(
			urlBuilder({
				assetId: selectedScenarioAssets[targetIndex].id,
				runId: isPersonMode ? null : requestedRunId,
			})
		);
	}

	return {
		mediaAssets,
		navigateToMedia,
		selectedMediaAsset,
		selectedMediaId,
		selectedMediaIndex,
		selectedScenarioAssets,
	};
}
