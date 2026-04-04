import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { type RunStatus, transitionRunStatus } from "@/domain/jobs/run-state";
import {
	createScenarioDraftSchema,
	scenarioRunDraftSchema,
	type JsonValue,
} from "@/domain/scenarios/scenario-schema";
import {
	createRunpodDispatchPayload,
	normalizeRunpodSubmitResponse,
	normalizeRunpodTerminalResult,
	type RunpodDispatchPayload,
} from "@/providers/runpod/runpod-contract";

interface ScenarioRecord {
	id: string;
	name: string;
	workflowKey: string;
	prompt: string;
	params: Record<string, JsonValue>;
}

interface RunRecord {
	id: string;
	scenarioId: string;
	status: RunStatus;
	inputImageUrl: string;
	externalJobId: string | null;
	errorSummary: string | null;
}

interface ArtifactRecord {
	runId: string;
	kind: string;
	url: string;
	fileName?: string;
}

interface RunpodProvider {
	submit: (payload: RunpodDispatchPayload) => Promise<unknown>;
	getResult: (jobId: string) => Promise<unknown>;
}

interface SyncResponse {
	run: RunRecord | null;
	artifacts: ArtifactRecord[];
}

function createInMemoryScenarioStore() {
	const scenarios: ScenarioRecord[] = [];
	const runs: RunRecord[] = [];
	const artifacts: ArtifactRecord[] = [];
	let sequence = 0;

	return {
		scenarios,
		runs,
		artifacts,
		createScenario(input: Omit<ScenarioRecord, "id">) {
			const record = { id: `scenario_${++sequence}`, ...input };
			scenarios.push(record);
			return record;
		},
		createRun(input: Omit<RunRecord, "id">) {
			const record = { id: `run_${++sequence}`, ...input };
			runs.push(record);
			return record;
		},
		findScenario(id: string) {
			return scenarios.find((scenario) => scenario.id === id) ?? null;
		},
		findRun(id: string) {
			return runs.find((run) => run.id === id) ?? null;
		},
		updateRun(id: string, mutate: (run: RunRecord) => void) {
			const run = runs.find((entry) => entry.id === id);

			if (!run) {
				throw new Error(`Missing run: ${id}`);
			}

			mutate(run);
			return run;
		},
		replaceArtifacts(runId: string, nextArtifacts: ArtifactRecord[]) {
			const remaining = artifacts.filter(
				(artifact) => artifact.runId !== runId,
			);
			artifacts.length = 0;
			artifacts.push(...remaining, ...nextArtifacts);
		},
	};
}

function createGenerationTestApp(provider: RunpodProvider) {
	const store = createInMemoryScenarioStore();
	const scenarioSchema = createScenarioDraftSchema(["ltx-2.3 i2v"]);
	const app = new Hono();

	app.post("/api/scenarios", async (c) => {
		const payload = scenarioSchema.parse(await c.req.json());
		const scenario = store.createScenario(payload);
		return c.json(scenario, 201);
	});

	app.post("/api/scenarios/:scenarioId/runs", async (c) => {
		const scenarioId = c.req.param("scenarioId");
		const scenario = store.findScenario(scenarioId);

		if (!scenario) {
			return c.json({ message: "Scenario not found" }, 404);
		}

		const payload = scenarioRunDraftSchema.parse({
			scenarioId,
			...(await c.req.json()),
		});
		const dispatchPayload = createRunpodDispatchPayload({
			workflowKey: scenario.workflowKey,
			prompt: scenario.prompt,
			inputAssetUrl: payload.inputImage.assetUrl,
			params: scenario.params,
		});
		const providerSubmission = normalizeRunpodSubmitResponse(
			await provider.submit(dispatchPayload),
		);
		const run = store.createRun({
			scenarioId,
			status: providerSubmission.status,
			inputImageUrl: payload.inputImage.assetUrl,
			externalJobId: providerSubmission.jobId,
			errorSummary: null,
		});

		return c.json(run, 201);
	});

	app.post("/api/runs/:runId/sync", async (c) => {
		const run = store.findRun(c.req.param("runId"));

		if (!run?.externalJobId) {
			return c.json({ message: "Run not found" }, 404);
		}

		const providerResult = normalizeRunpodTerminalResult(
			await provider.getResult(run.externalJobId),
		);

		if (providerResult.status === "succeeded") {
			store.updateRun(run.id, (existingRun) => {
				existingRun.status = transitionRunStatus(
					existingRun.status,
					"succeeded",
				);
				existingRun.errorSummary = null;
			});
			store.replaceArtifacts(
				run.id,
				providerResult.artifacts.map((artifact) => ({
					runId: run.id,
					kind: artifact.kind,
					url: artifact.url,
					fileName: artifact.fileName,
				})),
			);
		} else {
			store.updateRun(run.id, (existingRun) => {
				existingRun.status = transitionRunStatus(existingRun.status, "failed");
				existingRun.errorSummary = providerResult.errorSummary;
			});
			store.replaceArtifacts(run.id, []);
		}

		return c.json({
			run: store.findRun(run.id),
			artifacts: store.artifacts.filter((artifact) => artifact.runId === run.id),
		});
	});

	return { app, store };
}

describe("generation verification scaffolding", () => {
	test("create scenario API persists the expected scenario record", async () => {
		const provider: RunpodProvider = {
			submit: () => Promise.resolve({ id: "job_123", status: "queued" }),
			getResult: () =>
				Promise.resolve({
					id: "job_123",
					status: "completed",
					output: { artifacts: [] },
				}),
		};
		const { app, store } = createGenerationTestApp(provider);
		const response = await app.request("/api/scenarios", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Operator scenario",
				workflowKey: "ltx-2.3 i2v",
				prompt: "Animate this still image into a cinematic reveal.",
				params: { seed: 99 },
			}),
		});

		expect(response.status).toBe(201);
		expect(store.scenarios).toEqual([
			{
				id: "scenario_1",
				name: "Operator scenario",
				workflowKey: "ltx-2.3 i2v",
				prompt: "Animate this still image into a cinematic reveal.",
				params: { seed: 99 },
			},
		]);
	});

	test("launch run API creates a run, calls the provider, and stores the external job id", async () => {
		const submittedPayloads: RunpodDispatchPayload[] = [];
		const provider: RunpodProvider = {
			submit: (payload) => {
				submittedPayloads.push(payload);
				return Promise.resolve({ id: "job_launch", status: "queued" });
			},
			getResult: () =>
				Promise.resolve({
					id: "job_launch",
					status: "completed",
					output: { artifacts: [] },
				}),
		};
		const { app, store } = createGenerationTestApp(provider);
		const createScenarioResponse = await app.request("/api/scenarios", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Scenario A",
				workflowKey: "ltx-2.3 i2v",
				prompt: "Prompt A",
				params: { seed: 7 },
			}),
		});
		const scenario = (await createScenarioResponse.json()) as ScenarioRecord;
		const runResponse = await app.request(`/api/scenarios/${scenario.id}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				inputImage: {
					assetUrl: "https://assets.internal.example/input-a.png",
					filename: "input-a.png",
					mimeType: "image/png",
				},
			}),
		});

		expect(runResponse.status).toBe(201);
		expect(submittedPayloads).toHaveLength(1);
		expect(submittedPayloads[0]).toEqual({
			input: {
				workflowKey: "ltx-2.3 i2v",
				prompt: "Prompt A",
				inputAssetUrl: "https://assets.internal.example/input-a.png",
				params: { seed: 7 },
			},
		});
		expect(store.runs).toEqual([
			{
				id: "run_2",
				scenarioId: "scenario_1",
				status: "queued",
				inputImageUrl: "https://assets.internal.example/input-a.png",
				externalJobId: "job_launch",
				errorSummary: null,
			},
		]);
	});

	test("status sync updates the run and artifact records on provider success", async () => {
		const provider: RunpodProvider = {
			submit: () => Promise.resolve({ id: "job_success", status: "running" }),
			getResult: () =>
				Promise.resolve({
					id: "job_success",
					status: "completed",
					output: {
						artifacts: [
							{
								kind: "video",
								url: "https://assets.internal.example/output-a.mp4",
								fileName: "output-a.mp4",
							},
						],
					},
				}),
		};
		const { app, store } = createGenerationTestApp(provider);
		const createScenarioResponse = await app.request("/api/scenarios", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Scenario A",
				workflowKey: "ltx-2.3 i2v",
				prompt: "Prompt A",
				params: { seed: 7 },
			}),
		});
		const scenario = (await createScenarioResponse.json()) as ScenarioRecord;
		const runResponse = await app.request(`/api/scenarios/${scenario.id}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				inputImage: {
					assetUrl: "https://assets.internal.example/input-a.png",
					filename: "input-a.png",
					mimeType: "image/png",
				},
			}),
		});
		const run = (await runResponse.json()) as RunRecord;
		const syncResponse = await app.request(`/api/runs/${run.id}/sync`, {
			method: "POST",
		});
		const syncedPayload = (await syncResponse.json()) as SyncResponse;

		expect(syncResponse.status).toBe(200);
		expect(syncedPayload.run?.status).toBe("succeeded");
		expect(store.artifacts).toEqual([
			{
				runId: run.id,
				kind: "video",
				url: "https://assets.internal.example/output-a.mp4",
				fileName: "output-a.mp4",
			},
		]);
	});

	test("failed provider responses persist diagnosable error state", async () => {
		const provider: RunpodProvider = {
			submit: () => Promise.resolve({ id: "job_failed", status: "running" }),
			getResult: () =>
				Promise.resolve({
					jobId: "job_failed",
					state: "failed",
					error: {
						message: "GPU worker unavailable",
						code: "WORKER_UNAVAILABLE",
					},
				}),
		};
		const { app } = createGenerationTestApp(provider);
		const createScenarioResponse = await app.request("/api/scenarios", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Scenario A",
				workflowKey: "ltx-2.3 i2v",
				prompt: "Prompt A",
				params: { seed: 7 },
			}),
		});
		const scenario = (await createScenarioResponse.json()) as ScenarioRecord;
		const runResponse = await app.request(`/api/scenarios/${scenario.id}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				inputImage: {
					assetUrl: "https://assets.internal.example/input-a.png",
					filename: "input-a.png",
					mimeType: "image/png",
				},
			}),
		});
		const run = (await runResponse.json()) as RunRecord;
		const syncResponse = await app.request(`/api/runs/${run.id}/sync`, {
			method: "POST",
		});
		const syncedPayload = (await syncResponse.json()) as SyncResponse;

		expect(syncResponse.status).toBe(200);
		expect(syncedPayload.run?.status).toBe("failed");
		expect(syncedPayload.run?.errorSummary).toBe("GPU worker unavailable");
		expect(syncedPayload.artifacts).toEqual([]);
	});

	test("rerunning a scenario with a second input image creates a distinct run", async () => {
		const requestedAssets: string[] = [];
		const provider: RunpodProvider = {
			submit: (payload) => {
				requestedAssets.push(payload.input.inputAssetUrl);
				return Promise.resolve({
					id: `job_${requestedAssets.length}`,
					status: "queued",
				});
			},
			getResult: (jobId) =>
				Promise.resolve({
					id: jobId,
					status: "completed",
					output: { artifacts: [] },
				}),
		};
		const { app, store } = createGenerationTestApp(provider);
		const createScenarioResponse = await app.request("/api/scenarios", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Scenario A",
				workflowKey: "ltx-2.3 i2v",
				prompt: "Prompt A",
				params: { seed: 7 },
			}),
		});
		const scenario = (await createScenarioResponse.json()) as ScenarioRecord;

		await app.request(`/api/scenarios/${scenario.id}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				inputImage: {
					assetUrl: "https://assets.internal.example/input-a.png",
					filename: "input-a.png",
					mimeType: "image/png",
				},
			}),
		});
		await app.request(`/api/scenarios/${scenario.id}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				inputImage: {
					assetUrl: "https://assets.internal.example/input-b.png",
					filename: "input-b.png",
					mimeType: "image/png",
				},
			}),
		});

		expect(requestedAssets).toEqual([
			"https://assets.internal.example/input-a.png",
			"https://assets.internal.example/input-b.png",
		]);
		expect(store.runs).toHaveLength(2);
		expect(new Set(store.runs.map((run) => run.id)).size).toBe(2);
		expect(new Set(store.runs.map((run) => run.scenarioId))).toEqual(
			new Set([scenario.id]),
		);
	});
});
