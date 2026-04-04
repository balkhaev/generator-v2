"use client";

import { Button } from "@generator/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@generator/ui/components/card";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { Loader2, Play, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createScenario,
  getOperatorConsoleSnapshot,
  launchScenarioRun,
  type AdminSnapshot,
  type CreateScenarioInput,
  type LaunchRunInput,
  type ScenarioRecord,
  type ScenarioRunRecord,
  type WorkflowDefinition,
} from "@/lib/runpod-admin-client";

const textareaClassName =
  "flex min-h-24 w-full rounded-none border border-input bg-transparent px-2.5 py-2 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";
const selectClassName =
  "flex h-8 w-full rounded-none border border-input bg-transparent px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

const statusClasses: Record<ScenarioRunRecord["status"], string> = {
  queued: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  running: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  succeeded: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

type ScenarioFormState = CreateScenarioInput;
type RunDraft = LaunchRunInput;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function createScenarioFormState(workflow: WorkflowDefinition): ScenarioFormState {
  return {
    name: "",
    workflowKey: workflow.key,
    prompt: "",
    notes: "",
    params: Object.fromEntries(
      workflow.parameters.map((parameter) => [parameter.key, parameter.defaultValue]),
    ),
  };
}

function createRunDraft(scenarioId: string): RunDraft {
  return {
    scenarioId,
    inputLabel: "",
    inputImageUrl: "",
  };
}

function StatusPill({ status }: { status: ScenarioRunRecord["status"] }) {
  return (
    <span
      className={`inline-flex rounded-none border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${statusClasses[status]}`}
    >
      {status}
    </span>
  );
}

export default function OperatorConsole() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingScenario, setIsSavingScenario] = useState(false);
  const [submittingRunId, setSubmittingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarioForm, setScenarioForm] = useState<ScenarioFormState | null>(null);
  const [runDrafts, setRunDrafts] = useState<Record<string, RunDraft>>({});

  const workflows = snapshot?.workflows ?? [];
  const scenarios = snapshot?.scenarios ?? [];
  const runs = snapshot?.runs ?? [];

  const selectedWorkflow = useMemo(() => {
    if (!scenarioForm) {
      return workflows[0] ?? null;
    }

    return workflows.find((workflow) => workflow.key === scenarioForm.workflowKey) ?? workflows[0] ?? null;
  }, [scenarioForm, workflows]);

  async function loadSnapshot({ silent = false }: { silent?: boolean } = {}) {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const nextSnapshot = await getOperatorConsoleSnapshot();

      setSnapshot(nextSnapshot);
      setError(null);
      setScenarioForm((current) => current ?? createScenarioFormState(nextSnapshot.workflows[0]!));
      setRunDrafts((current) => {
        const nextDrafts = { ...current };

        for (const scenario of nextSnapshot.scenarios) {
          nextDrafts[scenario.id] ??= createRunDraft(scenario.id);
        }

        return nextDrafts;
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load the operator console.";

      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadSnapshot();
  }, []);

  useEffect(() => {
    if (!selectedWorkflow) {
      return;
    }

    setScenarioForm((current) => {
      if (!current) {
        return createScenarioFormState(selectedWorkflow);
      }

      if (current.workflowKey === selectedWorkflow.key) {
        return current;
      }

      return createScenarioFormState(selectedWorkflow);
    });
  }, [selectedWorkflow]);

  if (isLoading || !scenarioForm || !selectedWorkflow) {
    return (
      <div className="flex min-h-[32rem] items-center justify-center border border-dashed px-6">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const recentRuns = runs.slice(0, 6);

  async function handleCreateScenario(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!scenarioForm.name.trim() || !scenarioForm.prompt.trim()) {
      toast.error("Scenario name and prompt are required.");
      return;
    }

    setIsSavingScenario(true);

    try {
      const result = await createScenario({
        ...scenarioForm,
        name: scenarioForm.name.trim(),
        prompt: scenarioForm.prompt.trim(),
        notes: scenarioForm.notes.trim(),
      });

      setSnapshot((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          source: result.source,
          warnings: result.warning ? [result.warning] : current.warnings,
          scenarios: [result.data, ...current.scenarios],
        };
      });
      setRunDrafts((current) => ({
        ...current,
        [result.data.id]: createRunDraft(result.data.id),
      }));
      setScenarioForm(createScenarioFormState(selectedWorkflow));
      toast.success(result.source === "server" ? "Scenario saved." : "Scenario saved in provisional mode.");
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "Unable to save scenario.");
    } finally {
      setIsSavingScenario(false);
    }
  }

  async function handleLaunchRun(scenario: ScenarioRecord) {
    const draft = runDrafts[scenario.id] ?? createRunDraft(scenario.id);

    if (!draft.inputLabel.trim() || !draft.inputImageUrl.trim()) {
      toast.error("Input label and image URL are required.");
      return;
    }

    setSubmittingRunId(scenario.id);

    try {
      const result = await launchScenarioRun({
        scenarioId: scenario.id,
        inputLabel: draft.inputLabel.trim(),
        inputImageUrl: draft.inputImageUrl.trim(),
      });

      setSnapshot((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          source: result.source,
          warnings: result.warning ? [result.warning] : current.warnings,
          runs: [result.data, ...current.runs],
        };
      });
      setRunDrafts((current) => ({
        ...current,
        [scenario.id]: createRunDraft(scenario.id),
      }));
      toast.success(result.source === "server" ? "Run queued." : "Run staged in provisional mode.");
    } catch (runError) {
      toast.error(runError instanceof Error ? runError.message : "Unable to launch run.");
    } finally {
      setSubmittingRunId(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Operator overview</CardTitle>
            <CardDescription>
              Build reusable scenarios, launch the same workflow against new images, and keep every Runpod job visible.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workflow registry</p>
              <p className="mt-2 text-3xl font-medium">{workflows.length}</p>
              <p className="text-muted-foreground">Hardcoded MVP entry ready for the ltx-2.3 i2v path.</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Scenario library</p>
              <p className="mt-2 text-3xl font-medium">{scenarios.length}</p>
              <p className="text-muted-foreground">Reusable prompt + parameter bundles for repeated operator runs.</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Recent runs</p>
              <p className="mt-2 text-3xl font-medium">{runs.length}</p>
              <p className="text-muted-foreground">Queued, running, succeeded, and failed states stay visible from one surface.</p>
            </div>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>Data source</span>
              <span className="border px-2 py-1">{snapshot.source}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadSnapshot({ silent: true })}>
              {isRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh
            </Button>
          </CardFooter>
        </Card>

        {snapshot.warnings.length > 0 ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>Provisional integration notes</CardTitle>
              <CardDescription>
                The UI is already wired to the intended API surface, with a browser-backed fallback while server routes are still landing.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {snapshot.warnings.map((warning) => (
                <div key={warning} className="border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  {warning}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Scenario library</CardTitle>
            <CardDescription>
              Review reusable scenario definitions and launch the same workflow against new image inputs.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {scenarios.length === 0 ? (
              <div className="border border-dashed px-4 py-6 text-muted-foreground">
                Create the first scenario to start the operator flow.
              </div>
            ) : (
              scenarios.map((scenario) => {
                const draft = runDrafts[scenario.id] ?? createRunDraft(scenario.id);

                return (
                  <article key={scenario.id} className="grid gap-4 border px-4 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)]">
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-medium">{scenario.name}</h3>
                          <p className="text-muted-foreground">{scenario.workflowKey}</p>
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Updated {formatDate(scenario.updatedAt)}
                        </p>
                      </div>
                      <p>{scenario.prompt}</p>
                      {scenario.notes ? <p className="text-muted-foreground">{scenario.notes}</p> : null}
                      <dl className="grid gap-2 sm:grid-cols-3">
                        {Object.entries(scenario.params).map(([key, value]) => (
                          <div key={key} className="border px-3 py-2">
                            <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{key}</dt>
                            <dd className="mt-1 text-sm font-medium">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    <div className="grid gap-3 border border-dashed px-3 py-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Launch run</p>
                        <p className="text-muted-foreground">
                          Queue the same scenario with a new input image or product angle.
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <div className="grid gap-2">
                          <Label htmlFor={`label-${scenario.id}`}>Input label</Label>
                          <Input
                            id={`label-${scenario.id}`}
                            value={draft.inputLabel}
                            onChange={(event) => {
                              const value = event.target.value;

                              setRunDrafts((current) => ({
                                ...current,
                                [scenario.id]: {
                                  ...draft,
                                  inputLabel: value,
                                },
                              }));
                            }}
                            placeholder="Front hero image"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`image-${scenario.id}`}>Input image URL</Label>
                          <Input
                            id={`image-${scenario.id}`}
                            value={draft.inputImageUrl}
                            onChange={(event) => {
                              const value = event.target.value;

                              setRunDrafts((current) => ({
                                ...current,
                                [scenario.id]: {
                                  ...draft,
                                  inputImageUrl: value,
                                },
                              }));
                            }}
                            placeholder="https://assets.example.com/source/front-shot.png"
                          />
                        </div>
                      </div>
                      <Button
                        onClick={() => void handleLaunchRun(scenario)}
                        disabled={submittingRunId === scenario.id}
                      >
                        {submittingRunId === scenario.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                        Launch run
                      </Button>
                    </div>
                  </article>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Create scenario</CardTitle>
            <CardDescription>
              Capture the workflow key, reusable prompt, and run parameters the operator will reuse across input images.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={(event) => void handleCreateScenario(event)}>
              <div className="grid gap-2">
                <Label htmlFor="workflow-key">Workflow</Label>
                <select
                  id="workflow-key"
                  className={selectClassName}
                  value={scenarioForm.workflowKey}
                  onChange={(event) => {
                    const workflow = workflows.find((item) => item.key === event.target.value);

                    if (!workflow) {
                      return;
                    }

                    setScenarioForm(createScenarioFormState(workflow));
                  }}
                >
                  {workflows.map((workflow) => (
                    <option key={workflow.key} value={workflow.key}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground">{selectedWorkflow.summary}</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scenario-name">Scenario name</Label>
                <Input
                  id="scenario-name"
                  value={scenarioForm.name}
                  onChange={(event) => {
                    const value = event.target.value;

                    setScenarioForm((current) =>
                      current
                        ? {
                            ...current,
                            name: value,
                          }
                        : current,
                    );
                  }}
                  placeholder="Studio hero pan"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scenario-prompt">Prompt</Label>
                <textarea
                  id="scenario-prompt"
                  className={textareaClassName}
                  value={scenarioForm.prompt}
                  onChange={(event) => {
                    const value = event.target.value;

                    setScenarioForm((current) =>
                      current
                        ? {
                            ...current,
                            prompt: value,
                          }
                        : current,
                    );
                  }}
                  placeholder={selectedWorkflow.promptHint}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scenario-notes">Operator notes</Label>
                <textarea
                  id="scenario-notes"
                  className={textareaClassName}
                  value={scenarioForm.notes}
                  onChange={(event) => {
                    const value = event.target.value;

                    setScenarioForm((current) =>
                      current
                        ? {
                            ...current,
                            notes: value,
                          }
                        : current,
                    );
                  }}
                  placeholder="Explain what input framing or product category this scenario is tuned for."
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {selectedWorkflow.parameters.map((parameter) => (
                  <div key={parameter.key} className="grid gap-2">
                    <Label htmlFor={parameter.key}>{parameter.label}</Label>
                    <Input
                      id={parameter.key}
                      value={scenarioForm.params[parameter.key] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;

                        setScenarioForm((current) =>
                          current
                            ? {
                                ...current,
                                params: {
                                  ...current.params,
                                  [parameter.key]: value,
                                },
                              }
                            : current,
                        );
                      }}
                    />
                    <p className="text-muted-foreground">{parameter.helperText}</p>
                  </div>
                ))}
              </div>
              <Button type="submit" disabled={isSavingScenario}>
                {isSavingScenario ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Save scenario
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run review</CardTitle>
            <CardDescription>
              Keep job state, provider ids, and artifact links visible so failures stay diagnosable.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {recentRuns.length === 0 ? (
              <div className="border border-dashed px-4 py-6 text-muted-foreground">
                Launch a run to populate the operator review queue.
              </div>
            ) : (
              recentRuns.map((run) => (
                <article key={run.id} className="grid gap-3 border px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">{run.scenarioName}</h3>
                      <p className="text-muted-foreground">{run.inputLabel}</p>
                    </div>
                    <StatusPill status={run.status} />
                  </div>
                  <dl className="grid gap-2 text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <dt>Created</dt>
                      <dd>{formatDate(run.createdAt)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Provider job</dt>
                      <dd className="font-mono text-[11px]">{run.providerJobId}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Input image</dt>
                      <dd className="truncate text-right">
                        <a className="underline" href={run.inputImageUrl} target="_blank" rel="noreferrer">
                          Open source
                        </a>
                      </dd>
                    </div>
                  </dl>
                  {run.errorSummary ? (
                    <div className="border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-700 dark:text-rose-300">
                      {run.errorSummary}
                    </div>
                  ) : null}
                  {run.artifactUrls.length > 0 ? (
                    <div className="grid gap-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Artifacts</p>
                      <div className="flex flex-wrap gap-2">
                        {run.artifactUrls.map((artifactUrl) => (
                          <a
                            key={artifactUrl}
                            className="border px-2 py-1 text-[10px] uppercase tracking-[0.18em] hover:bg-muted"
                            href={artifactUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open artifact
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </CardContent>
          {error ? (
            <CardFooter>
              <div className="w-full border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-700 dark:text-rose-300">
                {error}
              </div>
            </CardFooter>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
