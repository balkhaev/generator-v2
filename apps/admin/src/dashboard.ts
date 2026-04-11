import type {
	AdminDashboardSnapshot,
	DashboardRecentRun,
	DashboardRunStatusSummary,
	DashboardScenarioSummary,
} from "@generator/contracts/admin";

type RunStatus = DashboardRecentRun["status"];

interface ServerArtifactRecord {
	url?: string | null;
}

interface ServerScenarioRecord {
	createdAt?: string;
	id: string;
	name: string;
	updatedAt?: string;
	workflowKey: string;
}

interface StudioSnapshotResponse {
	runs: ServerRunRecord[];
	scenarios: ServerScenarioRecord[];
}

interface ServerRunRecord {
	artifacts?: ServerArtifactRecord[];
	createdAt?: string;
	errorSummary?: string | null;
	id: string;
	inputImageUrl: string;
	providerEndpointId?: string | null;
	providerJobId?: string | null;
	scenarioId: string;
	status: RunStatus;
	workflowKey: string;
}

const RECENT_RUN_LIMIT = 8;
const FILE_EXTENSION_PATTERN = /\.[a-z0-9]+$/i;
const TRAILING_SLASH_PATTERN = /\/$/;

function formatInputLabel(inputImageUrl: string) {
	try {
		const url = new URL(inputImageUrl);
		const fileName =
			url.pathname
				.split("/")
				.filter(Boolean)
				.at(-1)
				?.replace(FILE_EXTENSION_PATTERN, "") ?? "";
		return fileName || url.hostname;
	} catch {
		return inputImageUrl;
	}
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
	const response = await fetch(input, init);
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`.trim());
	}
	return (await response.json()) as T;
}

export async function getAdminDashboardSnapshot(
	studioBaseUrl: string
): Promise<AdminDashboardSnapshot> {
	try {
		const normalizedBaseUrl = studioBaseUrl.replace(TRAILING_SLASH_PATTERN, "");
		const snapshot = await fetchJson<StudioSnapshotResponse>(
			`${normalizedBaseUrl}/api/studio-snapshot`
		);

		const scenarioNameById = new Map(
			snapshot.scenarios.map((scenario) => [scenario.id, scenario.name])
		);
		const sortedRuns = [...snapshot.runs].sort((left, right) =>
			(right.createdAt ?? "").localeCompare(left.createdAt ?? "")
		);
		const runStatus = sortedRuns.reduce<DashboardRunStatusSummary>(
			(summary, run) => {
				summary[run.status] += 1;
				return summary;
			},
			{ failed: 0, queued: 0, running: 0, succeeded: 0 }
		);
		const scenarios = snapshot.scenarios
			.map((scenario) => {
				const scenarioRuns = sortedRuns.filter(
					(run) => run.scenarioId === scenario.id
				);
				const latestRun = scenarioRuns[0];
				return {
					id: scenario.id,
					lastRunAt: latestRun?.createdAt ?? null,
					lastRunStatus: latestRun?.status ?? null,
					name: scenario.name,
					runCount: scenarioRuns.length,
					updatedAt:
						scenario.updatedAt ??
						scenario.createdAt ??
						new Date().toISOString(),
					workflowKey: scenario.workflowKey,
				} satisfies DashboardScenarioSummary;
			})
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, 8);

		return {
			notices: [],
			recentRuns: sortedRuns.slice(0, RECENT_RUN_LIMIT).map(
				(run) =>
					({
						artifactCount: run.artifacts?.length ?? 0,
						createdAt: run.createdAt ?? new Date().toISOString(),
						errorSummary: run.errorSummary ?? null,
						id: run.id,
						inputImageUrl: run.inputImageUrl,
						inputLabel: formatInputLabel(run.inputImageUrl),
						primaryArtifactUrl:
							run.artifacts?.find((artifact) => artifact.url)?.url ?? null,
						providerEndpointId: run.providerEndpointId ?? null,
						providerJobId: run.providerJobId ?? null,
						scenarioName:
							scenarioNameById.get(run.scenarioId) ?? "Unknown scenario",
						status: run.status,
						workflowKey: run.workflowKey,
					}) satisfies DashboardRecentRun
			),
			runStatus,
			scenarios,
			snapshotAt: new Date().toISOString(),
		};
	} catch {
		return {
			notices: ["Unable to load the latest studio runs from the API."],
			recentRuns: [],
			runStatus: { failed: 0, queued: 0, running: 0, succeeded: 0 },
			scenarios: [],
			snapshotAt: new Date().toISOString(),
		};
	}
}
