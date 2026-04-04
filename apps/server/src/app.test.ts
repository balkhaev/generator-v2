import { describe, expect, it } from "bun:test";

import {
  type ArtifactRecord,
  type OperatorRepository,
  type RunRecord,
  type ScenarioRecord,
} from "@/domain/operator";
import { createApp } from "@/app";

function createMemoryRepository(): OperatorRepository {
  const scenarios = new Map<string, ScenarioRecord>();
  const runs = new Map<string, RunRecord>();
  const artifacts = new Map<string, ArtifactRecord[]>();

  return {
    async listScenarios() {
      return [...scenarios.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },
    async getScenarioById(scenarioId) {
      return scenarios.get(scenarioId) ?? null;
    },
    async createScenario(input) {
      const scenario: ScenarioRecord = {
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarios.set(scenario.id, scenario);
      return scenario;
    },
    async updateScenario(scenarioId, input) {
      const current = scenarios.get(scenarioId);
      if (!current) {
        return null;
      }
      const updated: ScenarioRecord = {
        ...current,
        ...input,
        updatedAt: new Date(),
      };
      scenarios.set(scenarioId, updated);
      return updated;
    },
    async deleteScenario(scenarioId) {
      return scenarios.delete(scenarioId);
    },
    async listRuns() {
      return [...runs.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async getRunById(runId) {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }
      return { ...run, artifacts: artifacts.get(runId) ?? [] };
    },
    async createRun(input) {
      const run: RunRecord = {
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        artifacts: [],
      };
      runs.set(run.id, run);
      artifacts.set(run.id, []);
      return run;
    },
    async updateRun(runId, input) {
      const current = runs.get(runId);
      if (!current) {
        return null;
      }
      const updated: RunRecord = {
        ...current,
        ...input,
        completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt,
        updatedAt: new Date(),
        artifacts: artifacts.get(runId) ?? [],
      };
      runs.set(runId, updated);
      return updated;
    },
    async replaceArtifacts(runId, nextArtifacts) {
      const storedArtifacts: ArtifactRecord[] = nextArtifacts.map((artifact) => ({
        ...artifact,
        createdAt: new Date(),
      }));
      artifacts.set(runId, storedArtifacts);
      const current = runs.get(runId);
      if (current) {
        runs.set(runId, { ...current, artifacts: storedArtifacts, updatedAt: new Date() });
      }
      return storedArtifacts;
    },
  };
}

describe("operator api", () => {
  it("creates a scenario, launches reruns, and syncs artifacts", async () => {
    const repository = createMemoryRepository();
    const statuses = new Map<string, number>();

    const app = createApp({
      corsOrigin: "http://localhost:3001",
      repository,
      runpodClient: {
        async submit(payload) {
          return {
            jobId: `job-${(payload.inputImageUrl as string).split("/").at(-1)}`,
            status: "queued",
          };
        },
        async getStatus(jobId) {
          const count = (statuses.get(jobId) ?? 0) + 1;
          statuses.set(jobId, count);
          if (jobId.endsWith("fail.png")) {
            return {
              jobId,
              status: "failed",
              output: null,
              errorSummary: "provider failed",
            };
          }
          return {
            jobId,
            status: "succeeded",
            output: {
              videoUrl: `https://cdn.example.com/${jobId}.mp4`,
            },
            errorSummary: null,
          };
        },
      },
      storageAdapter: {
        normalizeInputImageUrl(inputImageUrl) {
          return inputImageUrl;
        },
        normalizeOutputUrl(outputUrl) {
          return outputUrl;
        },
        createInputAssetKey(filename) {
          return `https://assets.example.com/${filename}`;
        },
      },
      loggerImpl: console,
    });

    const scenarioResponse = await app.request(
      new Request("http://localhost/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "LTX operator demo",
          workflowKey: "ltx-2.3-i2v",
          prompt: "Turn this still image into a cinematic motion clip",
          params: { steps: 40 },
        }),
      }),
    );
    expect(scenarioResponse.status).toBe(201);
    const { scenario } = (await scenarioResponse.json()) as { scenario: ScenarioRecord };
    expect(scenario.workflowKey).toBe("ltx-2.3-i2v");

    const firstRunResponse = await app.request(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          inputImageUrl: "https://assets.example.com/input-a.png",
        }),
      }),
    );
    expect(firstRunResponse.status).toBe(201);
    const { run: firstRun } = (await firstRunResponse.json()) as { run: RunRecord };
    expect(firstRun.providerJobId).toBe("job-input-a.png");

    const secondRunResponse = await app.request(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          inputImageUrl: "https://assets.example.com/input-b.png",
        }),
      }),
    );
    expect(secondRunResponse.status).toBe(201);
    const { run: secondRun } = (await secondRunResponse.json()) as { run: RunRecord };
    expect(secondRun.scenarioId).toBe(scenario.id);
    expect(secondRun.id).not.toBe(firstRun.id);

    const syncResponse = await app.request(
      new Request(`http://localhost/api/runs/${firstRun.id}/sync`, {
        method: "POST",
      }),
    );
    expect(syncResponse.status).toBe(200);
    const { run: syncedRun } = (await syncResponse.json()) as { run: RunRecord };
    expect(syncedRun.status).toBe("succeeded");
    expect(syncedRun.artifacts).toHaveLength(1);
    expect(syncedRun.artifacts[0]?.url).toBe("https://cdn.example.com/job-input-a.png.mp4");

    const listRunsResponse = await app.request(new Request("http://localhost/api/runs"));
    const { runs } = (await listRunsResponse.json()) as { runs: RunRecord[] };
    expect(runs).toHaveLength(2);
  });

  it("persists diagnosable provider failures", async () => {
    const repository = createMemoryRepository();

    const app = createApp({
      corsOrigin: "http://localhost:3001",
      repository,
      runpodClient: {
        async submit() {
          return {
            jobId: "job-fail.png",
            status: "queued",
          };
        },
        async getStatus() {
          return {
            jobId: "job-fail.png",
            status: "failed",
            output: null,
            errorSummary: "provider failed",
          };
        },
      },
      storageAdapter: {
        normalizeInputImageUrl(inputImageUrl) {
          return inputImageUrl;
        },
        normalizeOutputUrl(outputUrl) {
          return outputUrl;
        },
        createInputAssetKey(filename) {
          return filename;
        },
      },
      loggerImpl: console,
    });

    const scenarioResponse = await app.request(
      new Request("http://localhost/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Failure path",
          workflowKey: "ltx-2.3-i2v",
          prompt: "prompt",
          params: {},
        }),
      }),
    );
    const { scenario } = (await scenarioResponse.json()) as { scenario: ScenarioRecord };

    const runResponse = await app.request(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          inputImageUrl: "https://assets.example.com/fail.png",
        }),
      }),
    );
    const { run } = (await runResponse.json()) as { run: RunRecord };

    const syncResponse = await app.request(
      new Request(`http://localhost/api/runs/${run.id}/sync`, {
        method: "POST",
      }),
    );
    expect(syncResponse.status).toBe(200);
    const { run: failedRun } = (await syncResponse.json()) as { run: RunRecord };
    expect(failedRun.status).toBe("failed");
    expect(failedRun.errorSummary).toBe("provider failed");
  });
});
