import { describe, expect, it } from "bun:test";

import { createApp } from "@/app";
import { AssetReleaseReadService } from "@/domain/asset-releases-read";
import type {
	StudioArtifactEntity,
	StudioExecutionClient,
	StudioRepository,
	StudioRunEntity,
	StudioScenarioEntity,
} from "@/domain/studio";

function createMemoryRepository(): StudioRepository {
	const scenarios = new Map<string, StudioScenarioEntity>();
	const runs = new Map<string, StudioRunEntity>();
	const artifacts = new Map<string, StudioArtifactEntity[]>();

	return {
		createRun(input) {
			const run: StudioRunEntity = {
				...input,
				artifacts: [],
				completedAt: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			runs.set(run.id, run);
			artifacts.set(run.id, []);
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
		deleteScenario(scenarioId) {
			return Promise.resolve(scenarios.delete(scenarioId));
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
				run ? { ...run, artifacts: artifacts.get(runId) ?? [] } : null
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
		listRuns() {
			return Promise.resolve(
				[...runs.values()].map((run) => ({
					...run,
					artifacts: artifacts.get(run.id) ?? [],
				}))
			);
		},
		listActiveRuns(limit) {
			return Promise.resolve(
				[...runs.values()]
					.filter((run) => run.status === "queued" || run.status === "running")
					.map((run) => ({
						...run,
						artifacts: artifacts.get(run.id) ?? [],
					}))
					.slice(0, limit)
			);
		},
		listScenarios() {
			return Promise.resolve([...scenarios.values()]);
		},
		replaceArtifacts(runId, nextArtifacts) {
			const storedArtifacts = nextArtifacts.map((artifact) => ({
				...artifact,
				createdAt: new Date(),
			}));
			artifacts.set(runId, storedArtifacts);
			return Promise.resolve(storedArtifacts);
		},
		updateRun(runId, input) {
			const current = runs.get(runId);
			if (!current) {
				return Promise.resolve(null);
			}
			const updated: StudioRunEntity = {
				...current,
				...input,
				artifacts: artifacts.get(runId) ?? [],
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
}

function createExecutionClientStub(
	overrides?: Partial<StudioExecutionClient>
): StudioExecutionClient {
	return {
		createExecution(input) {
			return Promise.resolve({
				artifacts: [],
				errorSummary: null,
				id: "execution-1",
				inputImageUrl: input.inputImageUrl ?? "",
				providerEndpointId: null,
				providerJobId: null,
				status: "queued",
				workflowKey: input.workflowKey,
			});
		},
		getExecution() {
			return Promise.resolve({
				artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
				errorSummary: null,
				id: "execution-1",
				inputImageUrl: "",
				providerEndpointId: "endpoint-1",
				providerJobId: "job-1",
				status: "succeeded",
				workflowKey: "ltx-2.3-i2v",
			});
		},
		syncExecution(input) {
			return Promise.resolve({
				artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
				errorSummary: null,
				id: input.providerJobId,
				inputImageUrl: "",
				providerEndpointId: input.providerEndpointId ?? "endpoint-1",
				providerJobId: input.providerJobId,
				status: "succeeded",
				workflowKey: input.workflowKey,
			});
		},
		...overrides,
	};
}

function createAssetReleaseReadServiceStub() {
	return new AssetReleaseReadService({
		getAssetReleaseById() {
			return Promise.resolve(null);
		},
		listAssetReleases() {
			return Promise.resolve([]);
		},
	});
}

describe("studio backend", () => {
	it("rejects protected routes when session is missing", async () => {
		const app = createApp({
			assetReleaseReadService: createAssetReleaseReadServiceStub(),
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			repository: createMemoryRepository(),
		});

		const response = await app.request("http://localhost/api/scenarios");
		expect(response.status).toBe(401);
	});

	it("creates local scenarios and delegates execution to generator", async () => {
		const repository = createMemoryRepository();
		const calls: string[] = [];
		const app = createApp({
			assetReleaseReadService: createAssetReleaseReadServiceStub(),
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub({
				createExecution(input) {
					calls.push(`create:${input.workflowKey}`);
					return Promise.resolve({
						artifacts: [],
						errorSummary: null,
						id: "execution-1",
						inputImageUrl: input.inputImageUrl ?? "",
						providerEndpointId: "endpoint-1",
						providerJobId: "job-1",
						status: "running",
						workflowKey: input.workflowKey,
					});
				},
				getExecution() {
					calls.push("get:ltx-2.3-i2v");
					return Promise.resolve({
						artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
						errorSummary: null,
						id: "execution-1",
						inputImageUrl: "",
						providerEndpointId: "endpoint-1",
						providerJobId: "job-1",
						status: "succeeded",
						workflowKey: "ltx-2.3-i2v",
					});
				},
				syncExecution(input) {
					calls.push(`sync:${input.providerJobId}`);
					return Promise.resolve({
						artifacts: [{ url: "https://cdn.example.com/output.mp4" }],
						errorSummary: null,
						id: input.providerJobId,
						inputImageUrl: "",
						providerEndpointId: input.providerEndpointId ?? "endpoint-1",
						providerJobId: input.providerJobId,
						status: "succeeded",
						workflowKey: input.workflowKey,
					});
				},
			}),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
		});

		const scenarioResponse = await app.request(
			"http://localhost/api/scenarios",
			{
				body: JSON.stringify({
					name: "Studio scenario",
					params: { steps: 12 },
					prompt: "Generate a cinematic clip",
					workflowKey: "ltx-2.3-i2v",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}
		);
		expect(scenarioResponse.status).toBe(201);
		const { scenario } = (await scenarioResponse.json()) as {
			scenario: StudioScenarioEntity;
		};

		const runResponse = await app.request("http://localhost/api/runs", {
			body: JSON.stringify({
				inputImageUrl: "https://assets.example.com/input.png",
				scenarioId: scenario.id,
			}),
			headers: {
				"content-type": "application/json",
			},
			method: "POST",
		});
		expect(runResponse.status).toBe(201);
		const { run } = (await runResponse.json()) as { run: StudioRunEntity };
		expect(run.providerJobId).toBe("job-1");

		const syncResponse = await app.request(
			`http://localhost/api/runs/${run.id}/sync`,
			{ method: "POST" }
		);
		expect(syncResponse.status).toBe(200);
		const { run: syncedRun } = (await syncResponse.json()) as {
			run: StudioRunEntity;
		};
		expect(syncedRun.status).toBe("succeeded");
		expect(syncedRun.artifacts[0]?.url).toBe(
			"https://cdn.example.com/output.mp4"
		);
		expect(calls).toEqual(["create:ltx-2.3-i2v", "sync:job-1"]);
	});

	it("reads asset release routes from the local studio read-model", async () => {
		const app = createApp({
			assetReleaseReadService: createAssetReleaseReadServiceStub(),
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository: createMemoryRepository(),
		});

		const response = await app.request(
			"http://localhost/api/asset-releases?limit=5"
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ releases: [] });
	});

	it("reads asset release presets from the local studio read-model", async () => {
		const app = createApp({
			assetReleaseReadService: createAssetReleaseReadServiceStub(),
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository: createMemoryRepository(),
		});

		const response = await app.request(
			"http://localhost/api/asset-release-presets"
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			presets: Array<{ id: string }>;
		};
		expect(payload.presets.map((preset) => preset.id)).toEqual([
			"flux2dev",
			"lustify-apex-avatar",
			"redzit-1.5-avatar",
		]);
	});

	it("uploads input images for local studio launches", async () => {
		const app = createApp({
			assetReleaseReadService: createAssetReleaseReadServiceStub(),
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository: createMemoryRepository(),
		});
		const formData = new FormData();

		formData.set(
			"file",
			new File(["studio-image"], "studio-shot.png", { type: "image/png" })
		);

		const uploadResponse = await app.request(
			"http://localhost/api/input-assets",
			{
				body: formData,
				method: "POST",
			}
		);

		expect(uploadResponse.status).toBe(201);
		const { upload } = (await uploadResponse.json()) as {
			upload: { storage: string; url: string };
		};
		expect(upload.storage).toBe("local");
		expect(upload.url).toContain("/api/input-assets/");

		const fileResponse = await app.request(upload.url);

		expect(fileResponse.status).toBe(200);
		expect(fileResponse.headers.get("content-type")).toBe("image/png");
		expect(await fileResponse.text()).toBe("studio-image");
	});

	it("returns a studio-native aggregate snapshot", async () => {
		const repository = createMemoryRepository();
		const assetReleaseReadService = createAssetReleaseReadServiceStub();
		await repository.createScenario({
			generatorScenarioId: null,
			id: "scenario-1",
			name: "Snapshot scenario",
			params: { steps: 8 },
			prompt: "Snapshot prompt",
			workflowKey: "ltx-2.3-i2v",
		});
		await repository.createRun({
			errorSummary: null,
			generatorRunId: null,
			id: "run-1",
			inputImageUrl: "https://assets.example.com/input.png",
			providerEndpointId: "endpoint-1",
			providerJobId: "job-1",
			scenarioId: "scenario-1",
			status: "queued",
			workflowKey: "ltx-2.3-i2v",
		});

		const app = createApp({
			assetReleaseReadService,
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3002"],
			executionClient: createExecutionClientStub(),
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			repository,
		});

		const response = await app.request("http://localhost/api/studio-snapshot");

		expect(response.status).toBe(200);
		const snapshot = (await response.json()) as {
			presets: Array<{ id: string }>;
			runs: Array<{ scenarioName: string }>;
			scenarios: Array<{ name: string }>;
			workflows: Array<{ key: string }>;
		};
		expect(snapshot.presets.map((preset) => preset.id)).toEqual([
			"flux2dev",
			"lustify-apex-avatar",
			"redzit-1.5-avatar",
		]);
		expect(snapshot.scenarios[0]?.name).toBe("Snapshot scenario");
		expect(snapshot.runs[0]?.scenarioName).toBe("Snapshot scenario");
		expect(snapshot.workflows[0]?.key).toBe("ltx-2.3-i2v");
	});
});
