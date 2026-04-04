import { env } from "@generator/env/web";

export type WorkflowParameter = {
  key: string;
  label: string;
  defaultValue: string;
  helperText: string;
};

export type WorkflowDefinition = {
  key: string;
  name: string;
  summary: string;
  promptHint: string;
  parameters: WorkflowParameter[];
};

export type ScenarioRecord = {
  id: string;
  name: string;
  workflowKey: string;
  prompt: string;
  notes: string;
  params: Record<string, string>;
  updatedAt: string;
};

export type ScenarioRunRecord = {
  id: string;
  scenarioId: string;
  scenarioName: string;
  workflowKey: string;
  inputLabel: string;
  inputImageUrl: string;
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  providerJobId: string;
  artifactUrls: string[];
  errorSummary?: string;
};

export type AdminSnapshot = {
  workflows: WorkflowDefinition[];
  scenarios: ScenarioRecord[];
  runs: ScenarioRunRecord[];
  source: "server" | "provisional";
  warnings: string[];
};

export type CreateScenarioInput = {
  name: string;
  workflowKey: string;
  prompt: string;
  notes: string;
  params: Record<string, string>;
};

export type LaunchRunInput = {
  scenarioId: string;
  inputLabel: string;
  inputImageUrl: string;
};

export type MutationResult<T> = {
  data: T;
  source: "server" | "provisional";
  warning?: string;
};

type LocalAdminState = {
  scenarios: ScenarioRecord[];
  runs: ScenarioRunRecord[];
};

type JsonRecord = Record<string, unknown>;

const API_BASE_URL = env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");
const STORAGE_KEY = "generator.runpod-admin.v1";
const PROVISIONAL_WARNING =
  "Server routes are not available yet, so the UI is using provisional browser-backed data.";

const PROVISIONAL_WORKFLOWS: WorkflowDefinition[] = [
  {
    key: "ltx-2.3-i2v",
    name: "ltx-2.3 i2v",
    summary:
      "Run a single image-to-video workflow with reusable prompt controls before broadening the registry.",
    promptHint: "Describe the camera movement, pacing, and visual effect you want the output video to amplify.",
    parameters: [
      {
        key: "motion_bucket",
        label: "Motion bucket",
        defaultValue: "48",
        helperText: "Higher values push stronger motion for the generated clip.",
      },
      {
        key: "frame_count",
        label: "Frame count",
        defaultValue: "81",
        helperText: "Matches the initial MVP target for the ltx-2.3 i2v path.",
      },
      {
        key: "guidance_scale",
        label: "Guidance scale",
        defaultValue: "3.5",
        helperText: "Keeps prompt adherence visible without over-constraining the motion.",
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
      notes: "Baseline operator scenario for metallic product hero shots.",
      params: {
        motion_bucket: "48",
        frame_count: "81",
        guidance_scale: "3.5",
      },
      updatedAt: "2026-04-04T08:45:00.000Z",
    },
    {
      id: "scenario-demo-2",
      name: "Accessory reveal",
      workflowKey: "ltx-2.3-i2v",
      prompt:
        "Reveal the product from a three-quarter angle with a gentle orbit and high-detail studio reflections.",
      notes: "Used to compare different input hero shots with the same motion recipe.",
      params: {
        motion_bucket: "40",
        frame_count: "97",
        guidance_scale: "4.0",
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
      inputLabel: "Input image A",
      inputImageUrl: "https://images.unsplash.com/photo-1514996937319-344454492b37?auto=format&fit=crop&w=900&q=80",
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
      inputLabel: "Input image B",
      inputImageUrl: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80",
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
      inputLabel: "Detail crop",
      inputImageUrl: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
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

export async function getOperatorConsoleSnapshot(): Promise<AdminSnapshot> {
  try {
    const [workflowsPayload, scenariosPayload, runsPayload] = await Promise.all([
      requestJson<unknown>(`${API_BASE_URL}/api/workflows`),
      requestJson<unknown>(`${API_BASE_URL}/api/scenarios`),
      requestJson<unknown>(`${API_BASE_URL}/api/runs`),
    ]);

    return {
      workflows: extractCollection<WorkflowDefinition>(workflowsPayload, "workflows"),
      scenarios: sortByNewest(extractCollection<ScenarioRecord>(scenariosPayload, "scenarios")),
      runs: sortByNewest(extractCollection<ScenarioRunRecord>(runsPayload, "runs")),
      source: "server",
      warnings: [],
    };
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
    const scenario = extractRecord<ScenarioRecord>(payload, "scenario");

    if (!scenario) {
      throw new Error("Scenario response did not include a scenario record.");
    }

    return {
      data: scenario,
      source: "server",
    };
  } catch {
    const nextScenario: ScenarioRecord = {
      id: createId("scenario"),
      name: input.name,
      workflowKey: input.workflowKey,
      prompt: input.prompt,
      notes: input.notes,
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
    const run = extractRecord<ScenarioRunRecord>(payload, "run");

    if (!run) {
      throw new Error("Run response did not include a run record.");
    }

    return {
      data: run,
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
      inputLabel: input.inputLabel,
      inputImageUrl: input.inputImageUrl,
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
