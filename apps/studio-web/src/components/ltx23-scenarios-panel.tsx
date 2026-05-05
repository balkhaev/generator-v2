"use client";

import type {
	AdminSnapshot,
	ScenarioRecord,
	ScenarioRunRecord,
} from "@generator/studio-client/client";
import type { WorkflowDefinition } from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { RunProgressIndicator } from "@generator/ui/components/run-progress-indicator";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import {
	Clapperboard,
	ImagePlus,
	Pencil,
	Plus,
	Sparkles,
	Video,
} from "lucide-react";
import type { Route } from "next";
import { useMemo } from "react";

interface Ltx23ScenariosPanelProps {
	getScenarioHref: (scenarioId: string) => Route;
	onCreateScenario?: (workflowKey?: string) => void;
	onEditScenario?: (scenarioId: string) => void;
	onPickScenario: (scenarioId: string) => void;
	selectedScenarioId: string | null;
	snapshot: AdminSnapshot;
}

type ScenarioStatus = ScenarioRunRecord["status"] | "draft";

interface Ltx23PanelData {
	runCountByWorkflow: Map<string, number>;
	runsByScenario: Map<string, ScenarioRunRecord[]>;
	scenarioCountByWorkflow: Map<string, number>;
	scenarios: ScenarioRecord[];
	workflows: WorkflowDefinition[];
	workflowsByKey: Map<string, WorkflowDefinition>;
}

const LTX23_BASE_MODEL = "ltx-2-3";

const statusDot: Record<ScenarioStatus, string> = {
	draft: "bg-muted-foreground/40",
	failed: "bg-rose-500",
	queued: "bg-sky-500",
	running: "bg-amber-500 animate-pulse",
	succeeded: "bg-emerald-500",
};

const statusTone: Record<ScenarioStatus, string> = {
	draft: "bg-foreground/[0.05] text-muted-foreground",
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	running: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

function isLtx23Workflow(workflow: WorkflowDefinition) {
	return workflow.active && workflow.baseModel === LTX23_BASE_MODEL;
}

function sortByRecent(
	left: Pick<ScenarioRecord, "createdAt" | "updatedAt">,
	right: Pick<ScenarioRecord, "createdAt" | "updatedAt">
) {
	const leftDate = left.updatedAt ?? left.createdAt ?? "";
	const rightDate = right.updatedAt ?? right.createdAt ?? "";
	return rightDate.localeCompare(leftDate);
}

function toParamText(params: ScenarioRecord["params"], key: string) {
	const value = params?.[key];
	if (typeof value === "string") {
		return value.trim();
	}
	if (typeof value === "number") {
		return String(value);
	}
	return "";
}

function toParamNumber(params: ScenarioRecord["params"], key: string) {
	const value = params?.[key];
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(params: ScenarioRecord["params"]) {
	const duration = toParamNumber(params, "duration");
	if (duration === null || duration <= 0) {
		return null;
	}
	return `${duration.toFixed(duration % 1 === 0 ? 0 : 1)}s`;
}

function formatLoraStrength(params: ScenarioRecord["params"]) {
	const strength = toParamNumber(params, "loraStrength");
	if (strength === null) {
		return null;
	}
	return `${strength.toFixed(strength % 1 === 0 ? 0 : 2)}x`;
}

function getScenarioMeta(
	scenario: ScenarioRecord,
	workflow: WorkflowDefinition | null
) {
	const params = scenario.params ?? {};
	const resolution = toParamText(params, "resolution");
	const aspectRatio = toParamText(params, "aspectRatio");
	const duration = formatDuration(params);
	const loraStrength = formatLoraStrength(params);
	const source = workflow?.requiresInputImage ? "I2V" : "T2V";

	return [
		source,
		resolution && aspectRatio ? `${resolution} ${aspectRatio}` : resolution,
		duration,
		loraStrength,
	].filter(Boolean);
}

function buildPanelData(snapshot: AdminSnapshot): Ltx23PanelData {
	const workflows = snapshot.workflows.filter(isLtx23Workflow);
	const workflowsByKey = new Map(
		workflows.map((workflow) => [workflow.key, workflow])
	);
	const workflowKeys = new Set(workflowsByKey.keys());
	const scenarios = snapshot.scenarios
		.filter((scenario) => workflowKeys.has(scenario.workflowKey))
		.sort(sortByRecent);
	const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
	const runsByScenario = new Map<string, ScenarioRunRecord[]>();
	const scenarioCountByWorkflow = new Map<string, number>();
	const runCountByWorkflow = new Map<string, number>();

	for (const scenario of scenarios) {
		scenarioCountByWorkflow.set(
			scenario.workflowKey,
			(scenarioCountByWorkflow.get(scenario.workflowKey) ?? 0) + 1
		);
	}

	for (const run of snapshot.runs) {
		if (!scenarioIds.has(run.scenarioId)) {
			continue;
		}
		const scenarioRuns = runsByScenario.get(run.scenarioId) ?? [];
		scenarioRuns.push(run);
		runsByScenario.set(run.scenarioId, scenarioRuns);
		runCountByWorkflow.set(
			run.workflowKey,
			(runCountByWorkflow.get(run.workflowKey) ?? 0) + 1
		);
	}

	for (const scenarioRuns of runsByScenario.values()) {
		scenarioRuns.sort((left, right) =>
			right.createdAt.localeCompare(left.createdAt)
		);
	}

	return {
		runCountByWorkflow,
		runsByScenario,
		scenarioCountByWorkflow,
		scenarios,
		workflows,
		workflowsByKey,
	};
}

function WorkflowTile({
	onCreateScenario,
	runCount,
	scenarioCount,
	workflow,
}: {
	onCreateScenario?: (workflowKey?: string) => void;
	runCount: number;
	scenarioCount: number;
	workflow: WorkflowDefinition;
}) {
	const Icon = workflow.requiresInputImage ? ImagePlus : Video;
	const modeLabel = workflow.requiresInputImage ? "I2V" : "T2V";

	return (
		<div className="grid min-w-0 gap-2 rounded-lg bg-foreground/[0.03] p-2 ring-1 ring-foreground/6">
			<div className="flex min-w-0 items-start gap-2">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
					<Icon className="size-3.5" strokeWidth={1.8} />
				</span>
				<div className="grid min-w-0 flex-1 gap-0.5">
					<p className="truncate font-medium text-[11px] leading-tight">
						{workflow.name}
					</p>
					<div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
						<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5">
							{modeLabel}
						</span>
						<span className="truncate">{scenarioCount} scenarios</span>
						<span>{runCount} runs</span>
					</div>
				</div>
			</div>
			{onCreateScenario ? (
				<Button
					className="h-7 justify-center px-2 text-[10px]"
					onClick={() => onCreateScenario(workflow.key)}
					size="sm"
					variant="outline"
				>
					<Plus className="size-3" />
					Scenario
				</Button>
			) : null}
		</div>
	);
}

function StatusPill({ status }: { status: ScenarioStatus }) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]",
				statusTone[status]
			)}
		>
			<span className={cn("size-1.5 rounded-full", statusDot[status])} />
			{status}
		</span>
	);
}

function ScenarioRow({
	getScenarioHref,
	isSelected,
	onEditScenario,
	onPickScenario,
	runs,
	scenario,
	workflow,
}: {
	getScenarioHref: (scenarioId: string) => Route;
	isSelected: boolean;
	onEditScenario?: (scenarioId: string) => void;
	onPickScenario: (scenarioId: string) => void;
	runs: ScenarioRunRecord[];
	scenario: ScenarioRecord;
	workflow: WorkflowDefinition | null;
}) {
	const latestRun = runs[0] ?? null;
	const status = latestRun?.status ?? "draft";
	const meta = getScenarioMeta(scenario, workflow);
	const hasLiveRun =
		latestRun?.status === "queued" || latestRun?.status === "running";

	return (
		<div
			className={cn(
				"group/ltx-row grid min-w-0 gap-1 rounded-lg transition",
				isSelected
					? "bg-foreground text-background"
					: "bg-foreground/[0.03] hover:bg-foreground/[0.06]"
			)}
		>
			<div className="flex min-w-0 items-start gap-1.5 p-2">
				<a
					aria-current={isSelected ? "true" : undefined}
					className="grid min-w-0 flex-1 gap-1 text-left"
					href={getScenarioHref(scenario.id)}
					onClick={(event) => {
						if (
							event.defaultPrevented ||
							event.metaKey ||
							event.ctrlKey ||
							event.shiftKey ||
							event.altKey ||
							event.button !== 0
						) {
							return;
						}
						event.preventDefault();
						onPickScenario(scenario.id);
					}}
				>
					<div className="flex min-w-0 items-start justify-between gap-2">
						<div className="grid min-w-0 gap-0.5">
							<p
								className={cn(
									"truncate font-medium text-[11px] leading-tight",
									isSelected ? "text-background" : "text-foreground"
								)}
							>
								{scenario.name}
							</p>
							<p
								className={cn(
									"line-clamp-1 text-[10px] leading-tight",
									isSelected ? "text-background/65" : "text-muted-foreground"
								)}
							>
								{scenario.prompt || scenario.workflowKey}
							</p>
						</div>
						<StatusPill status={status} />
					</div>
					<div
						className={cn(
							"flex min-w-0 flex-wrap items-center gap-1 text-[10px]",
							isSelected ? "text-background/60" : "text-muted-foreground/80"
						)}
					>
						{meta.map((item) => (
							<span
								className={cn(
									"rounded-full px-1.5 py-0.5",
									isSelected ? "bg-background/10" : "bg-foreground/[0.05]"
								)}
								key={item}
							>
								{item}
							</span>
						))}
						<span
							className={cn(
								"rounded-full px-1.5 py-0.5",
								isSelected ? "bg-background/10" : "bg-foreground/[0.05]"
							)}
						>
							{runs.length} runs
						</span>
					</div>
				</a>
				{onEditScenario ? (
					<button
						aria-label={`Edit ${scenario.name}`}
						className={cn(
							"inline-flex size-6 shrink-0 items-center justify-center rounded-md transition",
							isSelected
								? "text-background/75 hover:bg-background/10 hover:text-background"
								: "text-muted-foreground hover:bg-muted hover:text-foreground"
						)}
						onClick={() => onEditScenario(scenario.id)}
						title="Edit scenario"
						type="button"
					>
						<Pencil className="size-3" />
					</button>
				) : null}
			</div>
			{hasLiveRun ? (
				<div
					className={cn(
						"px-2 pb-2 text-[10px]",
						isSelected ? "text-background/70" : "text-muted-foreground"
					)}
				>
					<RunProgressIndicator
						etaMs={latestRun.etaMs}
						expectedDurationMs={latestRun.expectedDurationMs}
						lastLogLine={latestRun.lastLogLine}
						phase={latestRun.phase}
						progressMonotonicKey={latestRun.id}
						progressPct={latestRun.progressPct}
						queuePosition={latestRun.queuePosition}
						runStartedAt={latestRun.createdAt}
						status={latestRun.status}
					/>
				</div>
			) : null}
		</div>
	);
}

export default function Ltx23ScenariosPanel({
	getScenarioHref,
	onCreateScenario,
	onEditScenario,
	onPickScenario,
	selectedScenarioId,
	snapshot,
}: Ltx23ScenariosPanelProps) {
	const data = useMemo(() => buildPanelData(snapshot), [snapshot]);

	if (data.workflows.length === 0) {
		return null;
	}

	return (
		<section className="grid min-w-0 gap-2 border-foreground/6 border-b px-3 py-2.5 dark:border-foreground/10">
			<div className="flex min-w-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">
					<Clapperboard className="size-3.5 text-muted-foreground" />
					<SectionLabel>LTX 2.3</SectionLabel>
				</div>
				<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">
					<Sparkles className="size-2.5" />
					Civitai
				</span>
			</div>

			<div className="grid min-w-0 gap-1.5">
				{data.workflows.map((workflow) => (
					<WorkflowTile
						key={workflow.key}
						onCreateScenario={onCreateScenario}
						runCount={data.runCountByWorkflow.get(workflow.key) ?? 0}
						scenarioCount={data.scenarioCountByWorkflow.get(workflow.key) ?? 0}
						workflow={workflow}
					/>
				))}
			</div>

			{data.scenarios.length === 0 ? (
				<EmptyState
					action={
						onCreateScenario ? (
							<Button
								onClick={() => onCreateScenario(data.workflows[0]?.key)}
								size="sm"
								variant="outline"
							>
								<Plus className="size-3.5" />
								Scenario
							</Button>
						) : null
					}
					hint="Create a Civitai LTX 2.3 scenario."
					message="No LTX 2.3 scenarios."
				/>
			) : (
				<div className="grid min-w-0 gap-1.5">
					{data.scenarios.map((scenario) => (
						<ScenarioRow
							getScenarioHref={getScenarioHref}
							isSelected={selectedScenarioId === scenario.id}
							key={scenario.id}
							onEditScenario={onEditScenario}
							onPickScenario={onPickScenario}
							runs={data.runsByScenario.get(scenario.id) ?? []}
							scenario={scenario}
							workflow={data.workflowsByKey.get(scenario.workflowKey) ?? null}
						/>
					))}
				</div>
			)}
		</section>
	);
}
