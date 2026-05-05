export type ScenarioRailStatus =
	| "draft"
	| "failed"
	| "queued"
	| "ready"
	| "running";

export type ScenarioGenerationKind = "photo" | "video";

export interface ScenarioCardData {
	duration: string;
	generationKind: ScenarioGenerationKind;
	id: string;
	name: string;
	prompt: string;
	runCount: number;
	status: ScenarioRailStatus;
	updatedAt: string | null;
	workflowKey: string;
}

export function getScenarioGenerationKind(
	workflowKey: string
): ScenarioGenerationKind {
	return workflowKey.toLowerCase().includes("video") ? "video" : "photo";
}
