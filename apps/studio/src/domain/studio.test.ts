import { describe, expect, it } from "bun:test";
import type { GeneratorExecutionRecord } from "@generator/contracts/generator";

import {
	buildPromptWithTriggerWords,
	type StudioArtifactEntity,
	type StudioExecutionClient,
	type StudioRepository,
	type StudioRunEntity,
	type StudioRunWireRecord,
	type StudioScenarioEntity,
	StudioService,
	type StudioShotEntity,
} from "@/domain/studio";

describe("buildPromptWithTriggerWords", () => {
	it("prepends new trigger words to the prompt", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "a quiet street at night",
				triggerWords: ["mystic", "neon city"],
			})
		).toBe("mystic, neon city, a quiet street at night");
	});

	it("skips trigger words that are already present (case-insensitive)", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "Mystic vibe with neon city lights",
				triggerWords: ["mystic", "neon city"],
			})
		).toBe("Mystic vibe with neon city lights");
	});

	it("de-duplicates trigger words case-insensitively", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "a portrait",
				triggerWords: ["alpha", "Alpha", "beta"],
			})
		).toBe("alpha, beta, a portrait");
	});

	it("ignores blank entries", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "p",
				triggerWords: ["", "  ", "x"],
			})
		).toBe("x, p");
	});

	it("returns the original prompt when there are no trigger words", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "p",
				triggerWords: [],
			})
		).toBe("p");
	});
});

function createMinimalRepository(): {
	repository: StudioRepository;
	scenarios: Map<string, StudioScenarioEntity>;
	runs: Map<string, StudioRunEntity>;
	artifactsByRun: Map<string, StudioArtifactEntity[]>;
} {
	const scenarios = new Map<string, StudioScenarioEntity>();
	const runs = new Map<string, StudioRunEntity>();
	const artifactsByRun = new Map<string, StudioArtifactEntity[]>();
	const shots = new Map<string, StudioShotEntity>();

	const repository: StudioRepository = {
		createRun(input) {
			const run: StudioRunEntity = {
				...input,
				artifacts: [],
				completedAt: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			runs.set(run.id, run);
			artifactsByRun.set(run.id, []);
			return Promise.resolve(run);
		},
		createScenario(input) {
			const scenario: StudioScenarioEntity = {
				...input,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			scenarios.set(scenario.id, scenario);
			return Promise.resolve(scenario);
		},
		createShot(input) {
			const shot: StudioShotEntity = { ...input, createdAt: new Date() };
			shots.set(shot.id, shot);
			return Promise.resolve(shot);
		},
		deleteScenario(scenarioId) {
			return Promise.resolve(scenarios.delete(scenarioId));
		},
		deleteShot(shotId) {
			return Promise.resolve(shots.delete(shotId));
		},
		getRunByGeneratorRunId(generatorRunId) {
			return Promise.resolve(
				[...runs.values()].find(
					(run) => run.generatorRunId === generatorRunId
				) ?? null
			);
		},
		getRunById(runId) {
			const run = runs.get(runId);
			return Promise.resolve(
				run ? { ...run, artifacts: artifactsByRun.get(runId) ?? [] } : null
			);
		},
		getScenarioByGeneratorScenarioId(generatorScenarioId) {
			return Promise.resolve(
				[...scenarios.values()].find(
					(scenario) => scenario.generatorScenarioId === generatorScenarioId
				) ?? null
			);
		},
		getScenarioById(scenarioId) {
			return Promise.resolve(scenarios.get(scenarioId) ?? null);
		},
		listActiveRuns(limit) {
			return Promise.resolve(
				[...runs.values()]
					.filter((run) => run.status === "queued" || run.status === "running")
					.map((run) => ({
						...run,
						artifacts: artifactsByRun.get(run.id) ?? [],
					}))
					.slice(0, limit)
			);
		},
		listRuns() {
			return Promise.resolve(
				[...runs.values()].map((run) => ({
					...run,
					artifacts: artifactsByRun.get(run.id) ?? [],
				}))
			);
		},
		listScenarios() {
			return Promise.resolve([...scenarios.values()]);
		},
		listShots() {
			return Promise.resolve([...shots.values()]);
		},
		replaceArtifacts(runId, nextArtifacts) {
			const stored = nextArtifacts.map((artifact) => ({
				...artifact,
				createdAt: new Date(),
			}));
			artifactsByRun.set(runId, stored);
			return Promise.resolve(stored);
		},
		updateRun(runId, input) {
			const current = runs.get(runId);
			if (!current) {
				return Promise.resolve(null);
			}
			const updated: StudioRunEntity = {
				...current,
				...input,
				artifacts: artifactsByRun.get(runId) ?? [],
				completedAt:
					input.completedAt === undefined
						? current.completedAt
						: input.completedAt,
				updatedAt: new Date(),
			};
			runs.set(runId, updated);
			return Promise.resolve(updated);
		},
		updateScenario(scenarioId, input) {
			const current = scenarios.get(scenarioId);
			if (!current) {
				return Promise.resolve(null);
			}
			const updated: StudioScenarioEntity = {
				...current,
				...input,
				updatedAt: new Date(),
			};
			scenarios.set(scenarioId, updated);
			return Promise.resolve(updated);
		},
	};

	return { artifactsByRun, repository, runs, scenarios };
}

const noopExecutionClient: StudioExecutionClient = {
	createExecution() {
		throw new Error("not used");
	},
	getExecution() {
		throw new Error("not used");
	},
	syncExecution() {
		throw new Error("not used");
	},
};

const silentLogger = {
	error: () => undefined,
	info: () => undefined,
	warn: () => undefined,
};

describe("StudioService.processStreamEvent", () => {
	it("emits SSE update with execution status/artifacts even when DB row is stale", async () => {
		const { repository, runs, scenarios } = createMinimalRepository();
		const scenarioId = "scenario-1";
		const runId = "run-1";
		scenarios.set(scenarioId, {
			createdAt: new Date(),
			generatorScenarioId: null,
			id: scenarioId,
			name: "Scenario",
			params: {},
			prompt: "p",
			updatedAt: new Date(),
			workflowKey: "fal-zimage-turbo",
		});
		runs.set(runId, {
			artifacts: [],
			completedAt: null,
			createdAt: new Date(),
			errorSummary: null,
			generatorRunId: "execution-1",
			id: runId,
			inputImageUrl: "",
			inputPersonGenerationId: null,
			inputPersonId: null,
			loraPersonId: null,
			progressPct: 50,
			providerEndpointId: "endpoint-1",
			providerJobId: "job-1",
			scenarioId,
			status: "running",
			updatedAt: new Date(),
			workflowKey: "fal-zimage-turbo",
		});

		const service = new StudioService(
			repository,
			noopExecutionClient,
			silentLogger
		);
		const received: StudioRunWireRecord[] = [];
		service.runUpdatesEmitter.subscribe((record) => received.push(record));

		const execution: GeneratorExecutionRecord = {
			artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
			errorSummary: null,
			id: "execution-1",
			inputImageUrl: "",
			progressPct: 100,
			providerEndpointId: "endpoint-1",
			providerJobId: "job-1",
			status: "succeeded",
			workflowKey: "fal-zimage-turbo",
		};

		await service.processStreamEvent({
			context: { runId },
			execution,
		});

		expect(received).toHaveLength(1);
		const emitted = received[0];
		if (!emitted) {
			throw new Error("expected emitted record");
		}
		expect(emitted.status).toBe("succeeded");
		expect(emitted.progressPct).toBe(100);
		expect(emitted.artifactUrls).toEqual([
			"https://cdn.example.com/output.mp4",
		]);
		// БД при этом НЕ должна быть тронута — это работа studio-worker'а.
		const dbRow = await repository.getRunById(runId);
		expect(dbRow?.status).toBe("running");
		expect(dbRow?.artifacts).toEqual([]);
	});

	it("does not regress status when execution is older than DB", async () => {
		const { repository, runs, scenarios } = createMinimalRepository();
		const scenarioId = "scenario-2";
		const runId = "run-2";
		scenarios.set(scenarioId, {
			createdAt: new Date(),
			generatorScenarioId: null,
			id: scenarioId,
			name: "Scenario",
			params: {},
			prompt: "p",
			updatedAt: new Date(),
			workflowKey: "fal-zimage-turbo",
		});
		runs.set(runId, {
			artifacts: [],
			completedAt: new Date(),
			createdAt: new Date(),
			errorSummary: null,
			generatorRunId: "execution-2",
			id: runId,
			inputImageUrl: "",
			inputPersonGenerationId: null,
			inputPersonId: null,
			loraPersonId: null,
			progressPct: 100,
			providerEndpointId: null,
			providerJobId: null,
			scenarioId,
			status: "succeeded",
			updatedAt: new Date(),
			workflowKey: "fal-zimage-turbo",
		});

		const service = new StudioService(
			repository,
			noopExecutionClient,
			silentLogger
		);
		const received: StudioRunWireRecord[] = [];
		service.runUpdatesEmitter.subscribe((record) => received.push(record));

		await service.processStreamEvent({
			context: { runId },
			execution: {
				artifacts: [],
				errorSummary: null,
				id: "execution-2",
				inputImageUrl: "",
				progressPct: 30,
				providerEndpointId: null,
				providerJobId: null,
				status: "running",
				workflowKey: "fal-zimage-turbo",
			},
		});

		expect(received).toHaveLength(1);
		const emitted = received[0];
		if (!emitted) {
			throw new Error("expected emitted record");
		}
		expect(emitted.status).toBe("succeeded");
	});
});
