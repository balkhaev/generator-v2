import { z } from "zod";

import { type StorageAdapter } from "@/providers/storage";
import { type RunpodClient } from "@/providers/runpod";
import { getWorkflowDefinition, listWorkflows } from "@/registry/workflows";

export const scenarioParamsSchema = z.record(z.string(), z.unknown()).default({});

export const createScenarioInputSchema = z.object({
  name: z.string().trim().min(1, "Scenario name is required"),
  workflowKey: z.string().trim().min(1, "Workflow key is required"),
  prompt: z.string().trim().min(1, "Prompt is required"),
  params: scenarioParamsSchema,
});

export const updateScenarioInputSchema = createScenarioInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field must be provided",
);

export const createRunInputSchema = z.object({
  scenarioId: z.string().trim().min(1, "Scenario id is required"),
  inputImageUrl: z.url("Input image URL must be a valid URL"),
});

export const scenarioRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export type ScenarioRunStatus = z.infer<typeof scenarioRunStatusSchema>;

const runTransitionMap: Record<ScenarioRunStatus, readonly ScenarioRunStatus[]> = {
  queued: ["queued", "running", "succeeded", "failed"],
  running: ["running", "succeeded", "failed"],
  succeeded: ["succeeded"],
  failed: ["failed"],
};

export function assertRunStatusTransition(current: ScenarioRunStatus, next: ScenarioRunStatus) {
  if (!runTransitionMap[current].includes(next)) {
    throw new Error(`Invalid run status transition: ${current} -> ${next}`);
  }
}

export type ScenarioRecord = {
  id: string;
  name: string;
  workflowKey: string;
  prompt: string;
  params: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ArtifactRecord = {
  id: string;
  runId: string;
  kind: string;
  url: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type RunRecord = {
  id: string;
  scenarioId: string;
  workflowKey: string;
  inputImageUrl: string;
  providerJobId: string | null;
  status: ScenarioRunStatus;
  errorSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  artifacts: ArtifactRecord[];
};

export type OperatorRepository = {
  listScenarios(): Promise<ScenarioRecord[]>;
  getScenarioById(scenarioId: string): Promise<ScenarioRecord | null>;
  createScenario(input: Omit<ScenarioRecord, "createdAt" | "updatedAt">): Promise<ScenarioRecord>;
  updateScenario(
    scenarioId: string,
    input: Partial<Pick<ScenarioRecord, "name" | "workflowKey" | "prompt" | "params">>,
  ): Promise<ScenarioRecord | null>;
  deleteScenario(scenarioId: string): Promise<boolean>;
  listRuns(): Promise<RunRecord[]>;
  getRunById(runId: string): Promise<RunRecord | null>;
  createRun(input: Omit<RunRecord, "createdAt" | "updatedAt" | "completedAt" | "artifacts">): Promise<RunRecord>;
  updateRun(
    runId: string,
    input: Partial<
      Pick<RunRecord, "providerJobId" | "status" | "errorSummary" | "completedAt" | "inputImageUrl">
    >,
  ): Promise<RunRecord | null>;
  replaceArtifacts(runId: string, artifacts: Omit<ArtifactRecord, "createdAt">[]): Promise<ArtifactRecord[]>;
};

type OperatorLogger = Pick<Console, "info" | "error">;

export function validateScenarioInput(input: z.input<typeof createScenarioInputSchema>) {
  const parsed = createScenarioInputSchema.parse(input);
  const workflow = getWorkflowDefinition(parsed.workflowKey);
  if (!workflow) {
    throw new Error(`Unknown workflow key: ${parsed.workflowKey}`);
  }

  return {
    ...parsed,
    params: workflow.parameterSchema.parse(parsed.params) as Record<string, unknown>,
  };
}

export class OperatorService {
  constructor(
    private readonly repository: OperatorRepository,
    private readonly runpodClient: RunpodClient,
    private readonly storageAdapter: StorageAdapter,
    private readonly logger: OperatorLogger = console,
  ) {}

  listWorkflows() {
    return listWorkflows();
  }

  listScenarios() {
    return this.repository.listScenarios();
  }

  async createScenario(input: z.input<typeof createScenarioInputSchema>) {
    const parsed = validateScenarioInput(input);
    return this.repository.createScenario({
      id: crypto.randomUUID(),
      ...parsed,
    });
  }

  async updateScenario(scenarioId: string, input: z.input<typeof updateScenarioInputSchema>) {
    const parsed = updateScenarioInputSchema.parse(input);
    const current = await this.repository.getScenarioById(scenarioId);
    if (!current) {
      return null;
    }

    const merged = validateScenarioInput({
      name: parsed.name ?? current.name,
      workflowKey: parsed.workflowKey ?? current.workflowKey,
      prompt: parsed.prompt ?? current.prompt,
      params: parsed.params ?? current.params,
    });

    return this.repository.updateScenario(scenarioId, merged);
  }

  getScenarioById(scenarioId: string) {
    return this.repository.getScenarioById(scenarioId);
  }

  deleteScenario(scenarioId: string) {
    return this.repository.deleteScenario(scenarioId);
  }

  listRuns() {
    return this.repository.listRuns();
  }

  getRunById(runId: string) {
    return this.repository.getRunById(runId);
  }

  async launchRun(input: z.input<typeof createRunInputSchema>) {
    const parsed = createRunInputSchema.parse(input);
    const scenario = await this.repository.getScenarioById(parsed.scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${parsed.scenarioId}`);
    }

    const workflow = getWorkflowDefinition(scenario.workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${scenario.workflowKey}`);
    }

    const normalizedInputImageUrl = this.storageAdapter.normalizeInputImageUrl(parsed.inputImageUrl);
    const run = await this.repository.createRun({
      id: crypto.randomUUID(),
      scenarioId: scenario.id,
      workflowKey: scenario.workflowKey,
      inputImageUrl: normalizedInputImageUrl,
      providerJobId: null,
      status: "queued",
      errorSummary: null,
    });

    const submission = await this.runpodClient.submit(
      workflow.buildRunpodInput({
        prompt: scenario.prompt,
        params: workflow.parameterSchema.parse(scenario.params),
        inputImageUrl: normalizedInputImageUrl,
      }),
    );

    this.logger.info("runpod.submit", {
      runId: run.id,
      providerJobId: submission.jobId,
      scenarioId: scenario.id,
      workflowKey: scenario.workflowKey,
    });

    return this.repository.updateRun(run.id, {
      providerJobId: submission.jobId,
      status: submission.status,
    });
  }

  async syncRun(runId: string) {
    const currentRun = await this.repository.getRunById(runId);
    if (!currentRun) {
      return null;
    }
    if (!currentRun.providerJobId) {
      throw new Error(`Run ${runId} has no provider job id`);
    }

    const workflow = getWorkflowDefinition(currentRun.workflowKey);
    if (!workflow) {
      throw new Error(`Workflow not found: ${currentRun.workflowKey}`);
    }

    const providerJob = await this.runpodClient.getStatus(currentRun.providerJobId);
    assertRunStatusTransition(currentRun.status, providerJob.status);

    const completedAt =
      providerJob.status === "succeeded" || providerJob.status === "failed" ? new Date() : null;
    const updatedRun = await this.repository.updateRun(runId, {
      status: providerJob.status,
      errorSummary: providerJob.errorSummary,
      completedAt,
    });

    if (!updatedRun) {
      return null;
    }

    if (providerJob.status === "succeeded") {
      const artifactUrls = workflow.extractArtifactUrls(providerJob.output);
      const artifacts = artifactUrls.map((url) => ({
        id: crypto.randomUUID(),
        runId,
        kind: url.match(/\.(mp4|mov|webm)(\?|$)/i) ? "video" : "image",
        url: this.storageAdapter.normalizeOutputUrl(url),
        metadata: {
          providerJobId: providerJob.jobId,
        },
      }));
      await this.repository.replaceArtifacts(runId, artifacts);
    }

    this.logger.info("runpod.status", {
      runId,
      providerJobId: providerJob.jobId,
      status: providerJob.status,
    });

    return this.repository.getRunById(runId);
  }
}
