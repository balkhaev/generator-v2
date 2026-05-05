"use client";

import {
	type AdminSnapshot,
	createStudioScenario,
	type ScenarioRecord,
	type ScenarioRunRecord,
} from "@generator/studio-client/client";
import {
	buildCreateScenarioInput,
	createScenarioFormState,
	type WorkflowDefinition,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { RunProgressIndicator } from "@generator/ui/components/run-progress-indicator";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import {
	Clapperboard,
	Dice5,
	ImagePlus,
	Loader2,
	Pencil,
	Plus,
	Sparkles,
	Type,
	Video,
} from "lucide-react";
import type { Route } from "next";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";

import RangeSlider from "@/components/compose/range-slider";

interface CivitaiLtx23PanelProps {
	getScenarioHref: (scenarioId: string) => Route;
	onEditScenario?: (scenarioId: string) => void;
	onPickScenario: (scenarioId: string) => void;
	onSnapshotChange: (snapshot: AdminSnapshot) => void;
	selectedScenarioId: string | null;
	snapshot: AdminSnapshot;
}

type ScenarioStatus = ScenarioRunRecord["status"] | "draft";
type CivitaiMode = "text" | "image";

interface CivitaiPanelData {
	runCount: number;
	runsByScenario: Map<string, ScenarioRunRecord[]>;
	scenarios: ScenarioRecord[];
	workflows: WorkflowDefinition[];
	workflowsByKey: Map<string, WorkflowDefinition>;
}

interface CivitaiDraft {
	aspectRatio: string;
	duration: number;
	endImageUrl: string;
	generateAudio: boolean;
	guidanceScale: number;
	loraStrength: number;
	name: string;
	prompt: string;
	resolution: string;
	seed: string;
	steps: number;
	workflowKey: string;
}

const CIVITAI_LTX23_TEXT_WORKFLOW_KEY = "civitai-ltx-2-3-synth-text-to-video";
const CIVITAI_LTX23_IMAGE_WORKFLOW_KEY = "civitai-ltx-2-3-synth-image-to-video";
const CIVITAI_LTX23_WORKFLOW_KEYS = new Set([
	CIVITAI_LTX23_TEXT_WORKFLOW_KEY,
	CIVITAI_LTX23_IMAGE_WORKFLOW_KEY,
]);

const aspectOptions = ["16:9", "3:2", "1:1", "2:3", "9:16"] as const;
const resolutionOptions = ["720p", "1080p"] as const;

const modeMeta: Record<
	CivitaiMode,
	{ icon: ReactNode; label: string; workflowKey: string }
> = {
	image: {
		icon: <ImagePlus className="size-3" />,
		label: "I2V",
		workflowKey: CIVITAI_LTX23_IMAGE_WORKFLOW_KEY,
	},
	text: {
		icon: <Type className="size-3" />,
		label: "T2V",
		workflowKey: CIVITAI_LTX23_TEXT_WORKFLOW_KEY,
	},
};

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

function isCivitaiLtx23Workflow(workflow: WorkflowDefinition) {
	return workflow.active && CIVITAI_LTX23_WORKFLOW_KEYS.has(workflow.key);
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

function getDefaultParam(workflow: WorkflowDefinition, key: string) {
	return createScenarioFormState(workflow).params[key] ?? "";
}

function getDefaultNumber(
	workflow: WorkflowDefinition,
	key: string,
	fallback: number
) {
	const parsed = Number(getDefaultParam(workflow, key));
	return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultBoolean(workflow: WorkflowDefinition, key: string) {
	return getDefaultParam(workflow, key) === "true";
}

function createCivitaiDraft(workflow: WorkflowDefinition): CivitaiDraft {
	return {
		aspectRatio: getDefaultParam(workflow, "aspectRatio") || "16:9",
		duration: getDefaultNumber(workflow, "duration", 5),
		endImageUrl: getDefaultParam(workflow, "endImageUrl"),
		generateAudio: getDefaultBoolean(workflow, "generateAudio"),
		guidanceScale: getDefaultNumber(workflow, "guidanceScale", 3),
		loraStrength: getDefaultNumber(workflow, "loraStrength", 1),
		name: "",
		prompt: "",
		resolution: getDefaultParam(workflow, "resolution") || "720p",
		seed: getDefaultParam(workflow, "seed"),
		steps: getDefaultNumber(workflow, "steps", 30),
		workflowKey: workflow.key,
	};
}

function getModeFromWorkflowKey(workflowKey: string): CivitaiMode {
	return workflowKey === CIVITAI_LTX23_IMAGE_WORKFLOW_KEY ? "image" : "text";
}

function buildPanelData(snapshot: AdminSnapshot): CivitaiPanelData {
	const workflows = snapshot.workflows.filter(isCivitaiLtx23Workflow);
	const workflowsByKey = new Map(
		workflows.map((workflow) => [workflow.key, workflow])
	);
	const workflowKeys = new Set(workflowsByKey.keys());
	const scenarios = snapshot.scenarios
		.filter((scenario) => workflowKeys.has(scenario.workflowKey))
		.sort(sortByRecent);
	const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
	const runsByScenario = new Map<string, ScenarioRunRecord[]>();
	let runCount = 0;

	for (const run of snapshot.runs) {
		if (!scenarioIds.has(run.scenarioId)) {
			continue;
		}
		const scenarioRuns = runsByScenario.get(run.scenarioId) ?? [];
		scenarioRuns.push(run);
		runsByScenario.set(run.scenarioId, scenarioRuns);
		runCount += 1;
	}

	for (const scenarioRuns of runsByScenario.values()) {
		scenarioRuns.sort((left, right) =>
			right.createdAt.localeCompare(left.createdAt)
		);
	}

	return {
		runCount,
		runsByScenario,
		scenarios,
		workflows,
		workflowsByKey,
	};
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

function getDraftErrors(draft: CivitaiDraft) {
	const errors: string[] = [];
	if (!draft.name.trim()) {
		errors.push("Name");
	}
	if (!draft.prompt.trim()) {
		errors.push("Prompt");
	}
	return errors;
}

function draftToForm(draft: CivitaiDraft, workflow: WorkflowDefinition) {
	const params: Record<string, string> = {
		...createScenarioFormState(workflow).params,
		aspectRatio: draft.aspectRatio,
		duration: String(draft.duration),
		generateAudio: draft.generateAudio ? "true" : "false",
		guidanceScale: String(draft.guidanceScale),
		loraStrength: String(draft.loraStrength),
		resolution: draft.resolution,
		seed: draft.seed.trim(),
		steps: String(draft.steps),
	};
	if (workflow.requiresInputImage) {
		params.endImageUrl = draft.endImageUrl.trim();
	}
	return {
		name: draft.name.trim(),
		params,
		prompt: draft.prompt.trim(),
		promptSource: null,
		workflowKey: workflow.key,
	};
}

function SegmentedField<TValue extends string>({
	columns = 2,
	label,
	onChange,
	options,
	value,
}: {
	columns?: number;
	label: string;
	onChange: (next: TValue) => void;
	options: readonly { icon?: ReactNode; label: string; value: TValue }[];
	value: TValue;
}) {
	return (
		<div className="grid gap-1.5">
			<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			<div
				className="grid gap-1"
				style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
			>
				{options.map((option) => {
					const active = value === option.value;
					return (
						<button
							aria-pressed={active}
							className={cn(
								"inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-2 text-[10px] transition",
								active
									? "bg-foreground text-background"
									: "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.09] hover:text-foreground"
							)}
							key={option.value}
							onClick={() => onChange(option.value)}
							type="button"
						>
							{option.icon}
							<span className="truncate">{option.label}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function SliderField({
	label,
	max,
	min,
	onChange,
	step,
	suffix,
	value,
}: {
	label: string;
	max: number;
	min: number;
	onChange: (next: number) => void;
	step?: number;
	suffix?: string;
	value: number;
}) {
	const id = useId();
	return (
		<div className="grid gap-1.5">
			<Label
				className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide"
				htmlFor={id}
			>
				{label}
			</Label>
			<RangeSlider
				id={id}
				max={max}
				min={min}
				onValueChange={onChange}
				step={step}
				suffix={suffix}
				value={value}
			/>
		</div>
	);
}

function CivitaiScenarioComposer({
	onPickScenario,
	onSnapshotChange,
	snapshot,
	workflows,
	workflowsByKey,
}: {
	onPickScenario: (scenarioId: string) => void;
	onSnapshotChange: (snapshot: AdminSnapshot) => void;
	snapshot: AdminSnapshot;
	workflows: WorkflowDefinition[];
	workflowsByKey: Map<string, WorkflowDefinition>;
}) {
	const firstWorkflow = workflows[0] ?? null;
	const endImageId = useId();
	const nameId = useId();
	const promptId = useId();
	const seedId = useId();
	const [draft, setDraft] = useState<CivitaiDraft | null>(() =>
		firstWorkflow ? createCivitaiDraft(firstWorkflow) : null
	);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!firstWorkflow) {
			setDraft(null);
			return;
		}
		setDraft((current) =>
			current && workflowsByKey.has(current.workflowKey)
				? current
				: createCivitaiDraft(firstWorkflow)
		);
	}, [firstWorkflow, workflowsByKey]);

	if (!draft) {
		return null;
	}

	const selectedWorkflow =
		workflowsByKey.get(draft.workflowKey) ?? firstWorkflow;
	if (!selectedWorkflow) {
		return null;
	}

	const mode = getModeFromWorkflowKey(draft.workflowKey);
	const errors = getDraftErrors(draft);
	const isReady = errors.length === 0;

	function updateDraft(next: Partial<CivitaiDraft>) {
		setDraft((current) => (current ? { ...current, ...next } : current));
	}

	function switchMode(nextMode: CivitaiMode) {
		const nextWorkflow = workflowsByKey.get(modeMeta[nextMode].workflowKey);
		if (!nextWorkflow) {
			return;
		}
		setDraft((current) => {
			const nextDraft = createCivitaiDraft(nextWorkflow);
			if (!current) {
				return nextDraft;
			}
			return {
				...nextDraft,
				aspectRatio: current.aspectRatio,
				duration: current.duration,
				generateAudio: current.generateAudio,
				guidanceScale: current.guidanceScale,
				loraStrength: current.loraStrength,
				name: current.name,
				prompt: current.prompt,
				resolution: current.resolution,
				seed: current.seed,
				steps: current.steps,
			};
		});
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!(draft && isReady) || isSaving) {
			return;
		}
		setIsSaving(true);
		try {
			const payload = buildCreateScenarioInput(
				selectedWorkflow,
				draftToForm(draft, selectedWorkflow)
			);
			const result = await createStudioScenario(payload);
			onSnapshotChange({
				...snapshot,
				scenarios: [result.data, ...snapshot.scenarios],
			});
			onPickScenario(result.data.id);
			toast.success("Civitai scenario saved.");
			setDraft(createCivitaiDraft(selectedWorkflow));
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Unable to save Civitai scenario."
			);
		} finally {
			setIsSaving(false);
		}
	}

	return (
		<form
			className="grid min-w-0 gap-3 rounded-lg bg-foreground/[0.03] p-2.5 ring-1 ring-foreground/6"
			onSubmit={handleSubmit}
		>
			<div className="flex min-w-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">
					<Video className="size-3 text-muted-foreground" />
					<SectionLabel>Civitai setup</SectionLabel>
				</div>
				<span className="truncate rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{selectedWorkflow.key}
				</span>
			</div>

			<SegmentedField
				label="Source"
				onChange={switchMode}
				options={(["text", "image"] as const)
					.map((value) => ({
						...modeMeta[value],
						value,
					}))
					.filter((option) => workflowsByKey.has(option.workflowKey))}
				value={mode}
			/>

			<div className="grid gap-2">
				<div className="grid gap-1.5">
					<Label
						className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide"
						htmlFor={nameId}
					>
						Name
					</Label>
					<Input
						className="h-8 text-xs"
						id={nameId}
						onChange={(event) => updateDraft({ name: event.target.value })}
						placeholder="Civitai synth clip"
						value={draft.name}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label
						className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide"
						htmlFor={promptId}
					>
						Prompt
					</Label>
					<textarea
						className="min-h-20 w-full resize-y rounded-lg border border-input bg-background/45 px-2 py-1.5 text-[11px] leading-snug outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
						id={promptId}
						onChange={(event) => updateDraft({ prompt: event.target.value })}
						placeholder="Cinematic movement, subject action, camera, lighting"
						value={draft.prompt}
					/>
				</div>
				{mode === "image" ? (
					<div className="grid gap-1.5">
						<Label
							className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide"
							htmlFor={endImageId}
						>
							Last frame URL
						</Label>
						<Input
							className="h-8 text-xs"
							id={endImageId}
							onChange={(event) =>
								updateDraft({ endImageUrl: event.target.value })
							}
							placeholder="Optional"
							value={draft.endImageUrl}
						/>
					</div>
				) : null}
			</div>

			<div className="grid gap-2">
				<SegmentedField
					label="Resolution"
					onChange={(resolution) => updateDraft({ resolution })}
					options={resolutionOptions.map((value) => ({ label: value, value }))}
					value={draft.resolution}
				/>
				<SegmentedField
					columns={5}
					label="Aspect"
					onChange={(aspectRatio) => updateDraft({ aspectRatio })}
					options={aspectOptions.map((value) => ({ label: value, value }))}
					value={draft.aspectRatio}
				/>
				<SliderField
					label="Duration"
					max={20}
					min={3}
					onChange={(duration) => updateDraft({ duration })}
					suffix="s"
					value={draft.duration}
				/>
				<SegmentedField
					label="Audio"
					onChange={(value) => updateDraft({ generateAudio: value === "true" })}
					options={[
						{ label: "Off", value: "false" },
						{ label: "On", value: "true" },
					]}
					value={draft.generateAudio ? "true" : "false"}
				/>
			</div>

			<div className="grid gap-2">
				<SliderField
					label="Steps"
					max={50}
					min={10}
					onChange={(steps) => updateDraft({ steps })}
					suffix="steps"
					value={draft.steps}
				/>
				<SliderField
					label="CFG"
					max={10}
					min={1}
					onChange={(guidanceScale) => updateDraft({ guidanceScale })}
					step={0.5}
					value={draft.guidanceScale}
				/>
				<SliderField
					label="Synth LoRA"
					max={2}
					min={0}
					onChange={(loraStrength) => updateDraft({ loraStrength })}
					step={0.05}
					value={draft.loraStrength}
				/>
			</div>

			<div className="grid gap-1.5">
				<Label
					className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide"
					htmlFor={seedId}
				>
					Seed
				</Label>
				<div className="flex items-center gap-1.5">
					<Input
						className="h-8 flex-1 text-[11px] tabular-nums"
						id={seedId}
						inputMode="numeric"
						onChange={(event) => updateDraft({ seed: event.target.value })}
						placeholder="Random"
						type="text"
						value={draft.seed}
					/>
					<button
						aria-label="Generate random seed"
						className="inline-flex h-8 items-center gap-1 rounded-lg border border-input bg-background/45 px-2 text-[10px] text-muted-foreground transition hover:bg-foreground/[0.05] hover:text-foreground"
						onClick={() =>
							updateDraft({ seed: String(Math.floor(Math.random() * 2 ** 31)) })
						}
						type="button"
					>
						<Dice5 className="size-3" />
						Random
					</button>
				</div>
			</div>

			<div className="flex min-w-0 items-center justify-between gap-2 border-foreground/6 border-t pt-2">
				<p className="truncate text-[10px] text-muted-foreground">
					{errors.length > 0 ? `${errors.join(" · ")} required` : "Ready"}
				</p>
				<Button disabled={!isReady || isSaving} size="sm" type="submit">
					{isSaving ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Plus className="size-3.5" />
					)}
					Save
				</Button>
			</div>
		</form>
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
				"group/civit-row grid min-w-0 gap-1 rounded-lg transition",
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

export default function CivitaiLtx23Panel({
	getScenarioHref,
	onEditScenario,
	onPickScenario,
	onSnapshotChange,
	selectedScenarioId,
	snapshot,
}: CivitaiLtx23PanelProps) {
	const data = useMemo(() => buildPanelData(snapshot), [snapshot]);

	if (data.workflows.length === 0) {
		return null;
	}

	return (
		<section className="grid min-w-0 gap-2 border-foreground/6 border-b px-3 py-2.5 dark:border-foreground/10">
			<div className="flex min-w-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">
					<Clapperboard className="size-3.5 text-muted-foreground" />
					<SectionLabel>Civitai LTX 2.3</SectionLabel>
				</div>
				<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">
					<Sparkles className="size-2.5" />
					Synth LoRA
				</span>
			</div>

			<CivitaiScenarioComposer
				onPickScenario={onPickScenario}
				onSnapshotChange={onSnapshotChange}
				snapshot={snapshot}
				workflows={data.workflows}
				workflowsByKey={data.workflowsByKey}
			/>

			<div className="flex items-center justify-between gap-2">
				<SectionLabel>Scenarios</SectionLabel>
				<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{data.scenarios.length} · {data.runCount} runs
				</span>
			</div>

			{data.scenarios.length === 0 ? (
				<EmptyState
					hint="Save a Civitai setup above."
					message="No Civitai scenarios."
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
