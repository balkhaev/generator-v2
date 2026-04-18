export type ScenarioRailStatus =
	| "draft"
	| "failed"
	| "queued"
	| "ready"
	| "running";

export interface ScenarioCardData {
	duration: string;
	id: string;
	name: string;
	prompt: string;
	runCount: number;
	status: ScenarioRailStatus;
	thumbnailUrl: string | null;
	updatedAt: string | null;
	workflowKey: string;
}
