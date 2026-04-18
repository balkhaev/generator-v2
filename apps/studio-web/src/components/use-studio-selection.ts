"use client";

import type { ScenarioRunRecord } from "@generator/studio-client/client";
import { useEffect } from "react";

import type { ScenarioCardData } from "@/components/scenario-card-data";

interface UseStudioSelectionInput {
	currentSearch: string;
	navigate: (href: string) => void;
	pathname: string;
	requestedPersonId: string | null;
	requestedRunId: string | null;
	requestedScenarioId: string | null;
	runs: ScenarioRunRecord[];
	scenarioCards: ScenarioCardData[];
	selectedPersonId: string | null;
	urlBuilder: (input: {
		assetId?: string | null;
		personId?: string | null;
		runId?: string | null;
		scenarioId?: string | null;
	}) => string;
}

export function useStudioSelection({
	navigate,
	requestedPersonId,
	requestedRunId,
	requestedScenarioId,
	runs,
	scenarioCards,
	selectedPersonId,
	urlBuilder,
}: UseStudioSelectionInput) {
	const requestedRun =
		(requestedRunId
			? runs.find(
					(run) =>
						run.id === requestedRunId || run.providerJobId === requestedRunId
				)
			: null) ?? null;
	const isPersonMode = selectedPersonId !== null;
	const fallbackScenarioId =
		(requestedScenarioId &&
		scenarioCards.some((scenario) => scenario.id === requestedScenarioId)
			? requestedScenarioId
			: null) ??
		requestedRun?.scenarioId ??
		scenarioCards[0]?.id ??
		null;
	const selectedScenarioId = isPersonMode ? null : fallbackScenarioId;
	const selectedScenarioCard = isPersonMode
		? null
		: (scenarioCards.find((scenario) => scenario.id === selectedScenarioId) ??
			null);

	useEffect(() => {
		const personOk = requestedPersonId === selectedPersonId;
		const scenarioOk = isPersonMode
			? requestedScenarioId === null
			: requestedScenarioId === selectedScenarioId;
		if (personOk && scenarioOk) {
			return;
		}
		navigate(
			urlBuilder({
				assetId: null,
				personId: selectedPersonId,
				runId: isPersonMode ? null : requestedRunId,
				scenarioId: selectedScenarioId,
			})
		);
	}, [
		isPersonMode,
		navigate,
		requestedPersonId,
		requestedRunId,
		requestedScenarioId,
		selectedPersonId,
		selectedScenarioId,
		urlBuilder,
	]);

	return {
		isPersonMode,
		requestedRun,
		selectedScenarioCard,
		selectedScenarioId,
	};
}
