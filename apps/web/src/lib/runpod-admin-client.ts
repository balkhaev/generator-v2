import { env } from "@generator/env/web";

export type WorkflowParameterType = "text" | "number";
export type ScenarioParamValue = string | number | boolean | null;

export interface WorkflowParameter {
  key: string;
  label: string;
  type: WorkflowParameterType;
  defaultValue: string;
  helperText: string;
}

export interface WorkflowDefinition {
  key: string;
  name: string;
  summary: string;
  promptHint: string;
  parameters: WorkflowParameter[];
}

export interface ScenarioRecord {
  id: string;
  name: string;
  workflowKey: string;
  prompt: string;
  params: Record<string, ScenarioParamValue>;
  updatedAt: string;
}

export interface ScenarioRunRecord {
  id: string;
  scenarioId: string;
  scenarioName: string;
  workflowKey: string;
  inputImageUrl: string;
  inputLabel: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  providerJobId: string | null;
  artifactUrls: string[];
  errorSummary?: string | null;
}

export interface AdminSnapshot {
  workflows: WorkflowDefinition[];
  scenarios: ScenarioRecord[];
  runs: ScenarioRunRecord[];
  source: "server" | "provisional";
  warnings: string[];
}

export interface ScenarioFormState {
  name: string;
  workflowKey: string;
  prompt: string;
  params: Record<string, string>;
}

export interface CreateScenarioInput {
  name: string;
  workflowKey: string;
  prompt: string;
  params: Record<string, ScenarioParamValue>;
}

export interface LaunchRunInput {
  scenarioId: string;
  inputImageUrl: string;
}

export interface MutationResult<T> {
  data: T;
  source: "server" | "provisional";
  warning?: string;
}

interface LocalAdminState {
  scenarios: ScenarioRecord[];
  runs: ScenarioRunRecord[];
}

interface ServerWorkflowField {
  key: string;
  label: string;
  type: WorkflowParameterType;
  description: string;
}

interface ServerWorkflowSummary {
  key: string;
  name: string;
  description: string;
  parameterFields?: ServerWorkflowField[];
  defaults?: Record<string, unknown>;
}

interface ServerScenarioRecord {
  id: string;
  name: string;
  workflowKey: string;
  prompt: string;
  params?: Record<string, unknown>;
  updatedAt?: string;
  createdAt?: string;
}

interface ServerArtifactRecord {
  url?: string | null;
}

interface ServerRunRecord {
  id: string;
  scenarioId: string;
  workflowKey: string;
  inputImageUrl: string;
  status: ScenarioRunRecord["status"];
  providerJobId?: string | null;
  errorSummary?: string | null;
  createdAt?: string;
  artifacts?: ServerArtifactRecord[];
}

type JsonRecord = Record<string, unknown>;

const API_BASE_URL = env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");
const STORAGE_KEY = "generator.runpod-admin.v1";
const PROVISIONAL_WARNING =
  "Server routes are not available yet, so the UI is using provisional browser-backed data.";
const DEFAULT_PROMPT_HINT = "Describe the shot, camera movement, and effect you want the generated clip to amplify.";

const PROVISIONAL_WORKFLOWS: WorkflowDefinition[] = [
  {
    key: "ltx-2.3-i2v",
    name: "LTX 2.3 I2V",
    summary: "Internal image-to-video operator flow backed by a Runpod serverless ComfyUI worker.",
    promptHint: DEFAULT_PROMPT_HINT,
    parameters: [
      {
        key: "negativePrompt",
        label: "Negative prompt",
        type: "text",
        defaultValue: "",
        helperText: "Optional negative prompt forwarded to the workflow.",
      },
      {
        key: "steps",
        label: "Steps",
        type: "number",
        defaultValue: "30",
        helperText: "Inference steps for the workflow.",
      },
      {
        key: "guidanceScale",
        label: "Guidance scale",
        type: "number",
        defaultValue: "7",
        helperText: "Prompt guidance scale.",
      },
      {
        key: "seed",
        label: "Seed",
        type: "number",
        defaultValue: "",
        helperText: "Optional deterministic seed.",
      },
      {
        key: "frameRate",
        label: "Frame rate",
        type: "number",
        defaultValue: "24",
        helperText: "Frames per second for the generated output.",
      },
      {
        key: "motionBucket",
        label: "Motion bucket",
        type: "number",
        defaultValue: "127",
        helperText: "ComfyUI motion bucket strength.",
      },
      {
        key: "numFrames",
        label: "Frame count",
        type: "number",
        defaultValue: "97",
        helperText: "Target number of frames to render.",
      },
    ],
  },
];

const DEFAULT_LOCAL_STATE: LocalAdminState = {
  scenarios: [
    {
      id: "scenario-demo-1",
      name: "Hero cookware pan",
      workflowKey: "ltx-2.3-i2v",
      prompt:
        "Slow dolly-in across a premium cookware pan on a reflective counter with cinematic lighting and subtle steam.",
      params: {
        negativePrompt: "",
        steps: 30,
        guidanceScale: 7,
        seed: 99,
        frameRate: 24,
        motionBucket: 127,
        numFrames: 97,
      },
      updatedAt: "2026-04-04T08:45:00.000Z",
    },
    {
      id: "scenario-demo-2",
      name: "Accessory reveal",
      workflowKey: "ltx-2.3-i2v",
      prompt:
        "Reveal the product from a three-quarter angle with a gentle orbit and high-detail studio reflections.",
      params: {
        negativePrompt: "",
        steps: 28,
        guidanceScale: 6.5,
        seed: 104,
        frameRate: 24,
        motionBucket: 110,
        numFrames: 81,
      },
      updatedAt: "2026-04-04T08:50:00.000Z",
    },
  ],
  runs: [
    {
      id: "run-demo-1",
      scenarioId: "scenario-demo-1",
      scenarioName: "Hero cookware pan",
      workflowKey: "ltx-2.3-i2v",
      inputImageUrl: "https://images.unsplash.com/photo-1514996937319-344454492b37?auto=format&fit=crop&w=900&q=80",
      inputLabel: "photo-1514996937319-344454492b37",
      status: "succeeded",
      createdAt: "2026-04-04T08:46:00.000Z",
      providerJobId: "local-demo-001",
      artifactUrls: [
        "https://images.unsplash.com/photo-1514996937319-344454492b37?auto=format&fit=crop&w=900&q=80",
      ],
    },
    {
      id: "run-demo-2",
      scenarioId: "scenario-demo-1",
      scenarioName: "Hero cookware pan",
      workflowKey: "ltx-2.3-i2v",
      inputImageUrl: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80",
      inputLabel: "photo-1504674900247-0877df9cc836",
      status: "running",
      createdAt: "2026-04-04T08:54:00.000Z",
      providerJobId: "local-demo-002",
      artifactUrls: [],
    },
    {
      id: "run-demo-3",
      scenarioId: "scenario-demo-2",
      scenarioName: "Accessory reveal",
      workflowKey: "ltx-2.3-i2v",
      inputImageUrl: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
      inputLabel: "photo-1498050108023-c5249f4df085",
      status: "failed",
      createdAt: "2026-04-04T08:56:00.000Z",
      providerJobId: "local-demo-003",
      artifactUrls: [],
      errorSummary: "Runpod returned a terminal provider error while staging the input asset.",
    },
  ],
};

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function sortByNewest<T extends { createdAt?: string; updatedAt?: string }>(records: T[]) {
  return [...records].sort((left, right) => {
    const leftDate = left.updatedAt ?? left.createdAt ?? "";
    const rightDate = right.updatedAt ?? right.createdAt ?? "";

    return rightDate.localeCompare(leftDate);
  });
}

function isObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function toParamValue(value: unknown): ScenarioParamValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return JSON.stringify(value);
}

function stringifyParamValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

function createPromptHint(workflowName: string) {
  return `Describe the ${workflowName} shot, camera movement, and effect you want the generated clip to amplify.`;
}

function formatInputLabel(inputImageUrl: string) {
  try {
    const url = new URL(inputImageUrl);
    const lastPathSegment = url.pathname.split("/").filter(Boolean).at(-1)?.replace(/\.[a-z0-9]+$/i, "");

    return lastPathSegment || url.hostname;
  } catch {
    return inputImageUrl;
  }
}

function normalizeWorkflowDefinition(workflow: ServerWorkflowSummary): WorkflowDefinition {
  return {
    key: workflow.key,
    name: workflow.name,
    summary: workflow.description,
    promptHint: createPromptHint(workflow.name),
    parameters: (workflow.parameterFields ?? []).map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
      type: parameter.type,
      defaultValue: stringifyParamValue(workflow.defaults?.[parameter.key]),
      helperText: parameter.description,
    })),
  };
}

function normalizeScenarioRecord(record: ServerScenarioRecord): ScenarioRecord {
  return {
    id: record.id,
    name: record.name,
    workflowKey: record.workflowKey,
    prompt: record.prompt,
    params: Object.fromEntries(
      Object.entries(record.params ?? {}).map(([key, value]) => [key, toParamValue(value)]),
    ),
    updatedAt: record.updatedAt ?? record.createdAt ?? new Date().toISOString(),
  };
}

function normalizeRunRecord(
  record: ServerRunRecord,
  scenarioNames: ReadonlyMap<string, string>,
): ScenarioRunRecord {
  return {
    id: record.id,
    scenarioId: record.scenarioId,
    scenarioName: scenarioNames.get(record.scenarioId) ?? "Unknown scenario",
    workflowKey: record.workflowKey,
    inputImageUrl: record.inputImageUrl,
    inputLabel: formatInputLabel(record.inputImageUrl),
    status: record.status,
    createdAt: record.createdAt ?? new Date().toISOString(),
    providerJobId: record.providerJobId ?? null,
    artifactUrls: (record.artifacts ?? [])
      .flatMap((artifact) => artifact.url ?? [])
      .filter((artifactUrl): artifactUrl is string => Boolean(artifactUrl)),
    errorSummary: record.errorSummary ?? null,
  };
}

function readLocalState(): LocalAdminState {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_STATE;
  }

  const rawState = window.localStorage.getItem(STORAGE_KEY);

  if (!rawState) {
    return DEFAULT_LOCAL_STATE;
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<LocalAdminState>;

    return {
      scenarios: Array.isArray(parsedState.scenarios)
        ? (parsedState.scenarios as ScenarioRecord[])
        : DEFAULT_LOCAL_STATE.scenarios,
      runs: Array.isArray(parsedState.runs)
        ? (parsedState.runs as ScenarioRunRecord[])
        : DEFAULT_LOCAL_STATE.runs,
    };
  } catch {
    return DEFAULT_LOCAL_STATE;
  }
}

function writeLocalState(state: LocalAdminState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function buildProvisionalSnapshot(state = readLocalState()): AdminSnapshot {
  return {
    workflows: PROVISIONAL_WORKFLOWS,
    scenarios: sortByNewest(state.scenarios),
    runs: sortByNewest(state.runs),
    source: "provisional",
    warnings: [PROVISIONAL_WARNING],
  };
}

async function requestJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  return (await response.json()) as T;
}

function extractCollection<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (isObject(payload) && Array.isArray(payload[key])) {
    return payload[key] as T[];
  }

  return [];
}

function extractRecord<T>(payload: unknown, key: string): T | null {
  if (isObject(payload) && isObject(payload[key])) {
    return payload[key] as T;
  }

  if (isObject(payload)) {
    return payload as T;
  }

  return null;
}

export function createScenarioFormState(workflow: WorkflowDefinition): ScenarioFormState {
  return {
    name: "",
    workflowKey: workflow.key,
    prompt: "",
    params: Object.fromEntries(
      workflow.parameters.map((parameter) => [parameter.key, parameter.defaultValue]),
    ),
  };
}

export function buildCreateScenarioInput(
  workflow: WorkflowDefinition,
  form: ScenarioFormState,
): CreateScenarioInput {
  return {
    name: form.name,
    workflowKey: form.workflowKey,
    prompt: form.prompt,
    params: Object.fromEntries(
      workflow.parameters.flatMap((parameter) => {
        const rawValue = form.params[parameter.key]?.trim() ?? "";

        if (parameter.type === "number") {
          if (rawValue === "") {
            return [];
          }

          const parsedValue = Number(rawValue);

          if (!Number.isFinite(parsedValue)) {
            throw new Error(`${parameter.label} must be a valid number.`);
          }

          return [[parameter.key, parsedValue]];
        }

        return [[parameter.key, rawValue]];
      }),
    ),
  };
}

export function normalizeServerSnapshot(params: {
  workflowsPayload: unknown;
  scenariosPayload: unknown;
  runsPayload: unknown;
}): AdminSnapshot {
  const scenarios = sortByNewest(
    extractCollection<ServerScenarioRecord>(params.scenariosPayload, "scenarios").map(
      normalizeScenarioRecord,
    ),
  );
  const scenarioNames = new Map(scenarios.map((scenario) => [scenario.id, scenario.name]));

  return {
    workflows: extractCollection<ServerWorkflowSummary>(params.workflowsPayload, "workflows").map(
      normalizeWorkflowDefinition,
    ),
    scenarios,
    runs: sortByNewest(
      extractCollection<ServerRunRecord>(params.runsPayload, "runs").map((run) =>
        normalizeRunRecord(run, scenarioNames),
      ),
    ),
    source: "server",
    warnings: [],
  };
}

export async function getOperatorConsoleSnapshot(): Promise<AdminSnapshot> {
  try {
    const [workflowsPayload, scenariosPayload, runsPayload] = await Promise.all([
      requestJson<unknown>(`${API_BASE_URL}/api/workflows`),
      requestJson<unknown>(`${API_BASE_URL}/api/scenarios`),
      requestJson<unknown>(`${API_BASE_URL}/api/runs`),
    ]);

    return normalizeServerSnapshot({
      workflowsPayload,
      scenariosPayload,
      runsPayload,
    });
  } catch {
    return buildProvisionalSnapshot();
  }
}

export async function createScenario(
  input: CreateScenarioInput,
): Promise<MutationResult<ScenarioRecord>> {
  try {
    const payload = await requestJson<unknown>(`${API_BASE_URL}/api/scenarios`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const scenario = extractRecord<ServerScenarioRecord>(payload, "scenario");

    if (!scenario) {
      throw new Error("Scenario response did not include a scenario record.");
    }

    return {
      data: normalizeScenarioRecord(scenario),
      source: "server",
    };
  } catch {
    const nextScenario: ScenarioRecord = {
      id: createId("scenario"),
      name: input.name,
      workflowKey: input.workflowKey,
      prompt: input.prompt,
      params: input.params,
      updatedAt: new Date().toISOString(),
    };

    const currentState = readLocalState();
    const nextState = {
      ...currentState,
      scenarios: sortByNewest([nextScenario, ...currentState.scenarios]),
    };

    writeLocalState(nextState);

    return {
      data: nextScenario,
      source: "provisional",
      warning: PROVISIONAL_WARNING,
    };
  }
}

export async function launchScenarioRun(
  input: LaunchRunInput,
): Promise<MutationResult<ScenarioRunRecord>> {
  try {
    const payload = await requestJson<unknown>(`${API_BASE_URL}/api/runs`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const run = extractRecord<ServerRunRecord>(payload, "run");

    if (!run) {
      throw new Error("Run response did not include a run record.");
    }

    const snapshot = await getOperatorConsoleSnapshot();
    const scenarioNames = new Map(snapshot.scenarios.map((scenario) => [scenario.id, scenario.name]));

    return {
      data: normalizeRunRecord(run, scenarioNames),
      source: "server",
    };
  } catch {
    const currentState = readLocalState();
    const scenario = currentState.scenarios.find((item) => item.id === input.scenarioId);

    if (!scenario) {
      throw new Error("Scenario not found in provisional state.");
    }

    const nextRun: ScenarioRunRecord = {
      id: createId("run"),
      scenarioId: input.scenarioId,
      scenarioName: scenario.name,
      workflowKey: scenario.workflowKey,
      inputImageUrl: input.inputImageUrl,
      inputLabel: formatInputLabel(input.inputImageUrl),
      status: "queued",
      createdAt: new Date().toISOString(),
      providerJobId: createId("local-runpod"),
      artifactUrls: [],
    };

    const nextState = {
      ...currentState,
      runs: sortByNewest([nextRun, ...currentState.runs]),
    };

    writeLocalState(nextState);

    return {
      data: nextRun,
      source: "provisional",
      warning: PROVISIONAL_WARNING,
    };
  }
}

export async function syncScenarioRun(
  runId: string,
): Promise<MutationResult<ScenarioRunRecord>> {
  const snapshot = await getOperatorConsoleSnapshot();
  const scenarioNames = new Map(snapshot.scenarios.map((scenario) => [scenario.id, scenario.name]));

  try {
    const payload = await requestJson<unknown>(`${API_BASE_URL}/api/runs/${runId}/sync`, {
      method: "POST",
    });
    const run = extractRecord<ServerRunRecord>(payload, "run");

    if (!run) {
      throw new Error("Run response did not include a run record.");
    }

    return {
      data: normalizeRunRecord(run, scenarioNames),
      source: "server",
    };
  } catch {
    const currentRun = snapshot.runs.find((run) => run.id === runId);

    if (!currentRun) {
      throw new Error("Run not found.");
    }

    return {
      data: currentRun,
      source: snapshot.source,
      warning: snapshot.source === "provisional" ? PROVISIONAL_WARNING : undefined,
    };
  }
}
