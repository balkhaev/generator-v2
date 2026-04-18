"use client";

import {
	type AdminSnapshot,
	deleteStudioScenario,
} from "@generator/studio-client/client";
import { useCallback, useState } from "react";
import { toast } from "sonner";

interface UseScenarioDeletionInput {
	onAfterDelete?: (scenarioId: string) => void;
	setSnapshot: (updater: (current: AdminSnapshot) => AdminSnapshot) => void;
}

export function useScenarioDeletion({
	onAfterDelete,
	setSnapshot,
}: UseScenarioDeletionInput) {
	const [pendingDeleteScenarioId, setPendingDeleteScenarioId] = useState<
		string | null
	>(null);
	const [isDeletingScenario, setIsDeletingScenario] = useState(false);

	const requestDeleteScenario = useCallback((scenarioId: string) => {
		setPendingDeleteScenarioId(scenarioId);
	}, []);

	const cancelDeleteScenario = useCallback(() => {
		setPendingDeleteScenarioId(null);
	}, []);

	const confirmDeleteScenario = useCallback(async () => {
		if (!pendingDeleteScenarioId) {
			return;
		}
		const scenarioId = pendingDeleteScenarioId;
		setIsDeletingScenario(true);
		try {
			await deleteStudioScenario(scenarioId);
			setSnapshot((current) => ({
				...current,
				scenarios: current.scenarios.filter((entry) => entry.id !== scenarioId),
			}));
			onAfterDelete?.(scenarioId);
			toast.success("Scenario deleted.");
			setPendingDeleteScenarioId(null);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to delete scenario."
			);
		} finally {
			setIsDeletingScenario(false);
		}
	}, [onAfterDelete, pendingDeleteScenarioId, setSnapshot]);

	return {
		cancelDeleteScenario,
		confirmDeleteScenario,
		isDeletingScenario,
		pendingDeleteScenarioId,
		requestDeleteScenario,
	};
}
