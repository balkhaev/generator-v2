"use client";

import type { PersonRecord } from "@generator/contracts/persons";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import {
	type AdminSnapshot,
	enhanceStudioPrompt,
	type LaunchRunInput,
	launchStudioRun,
	type ScenarioRecord,
	type ScenarioRunRecord,
	type UploadedInputAsset,
	type WorkflowDefinition,
} from "@generator/studio-client/client";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { EnhancePromptButton } from "@generator/ui/components/enhance-prompt-button";
import { Input } from "@generator/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@generator/ui/components/popover";
import { SectionLabel } from "@generator/ui/components/section-label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import {
	Activity,
	Check,
	ChevronDown,
	Clock3,
	Copy,
	ExternalLink,
	Layers,
	Loader2,
	Pencil,
	Play,
	Plus,
	RotateCcw,
	Search,
	Trash2,
	UserRound,
	UsersRound,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import IconButton from "@/components/icon-button";
import PersonsInputPicker from "@/components/persons-input-picker";
import { getMediaType } from "@/components/preview-surface";
import type { ScenarioCardData } from "@/components/scenario-card-data";
import { listPersons } from "@/lib/persons-api";

interface CommandSidebarProps {
	className?: string;
	getScenarioHref: (scenarioId: string) => Route;
	onCreateScenario?: () => void;
	onDeleteScenario?: (scenarioId: string) => void | Promise<void>;
	onEditScenario?: (scenarioId: string) => void;
	onSnapshotChange?: (snapshot: AdminSnapshot) => void;
	scenarioCards: ScenarioCardData[];
	selectedScenarioId: string | null;
	snapshot: AdminSnapshot;
}

type RunFilter = "all" | "live" | "ready" | "failed";

type RunDraft = LaunchRunInput & {
	inputPersonGenerationId?: string | null;
	inputPersonId?: string | null;
	uploadStorage?: UploadedInputAsset["storage"] | null;
};

type LinkedPersonState = {
	personSlug: string;
	runId: string;
} | null;

const personsApiBaseUrl = normalizeBaseUrl(
	env.NEXT_PUBLIC_PERSONS_API_URL ?? "http://localhost:3003"
);

const runStatusTone: Record<ScenarioRunRecord["status"], string> = {
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	running: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

const runStatusDot: Record<ScenarioRunRecord["status"], string> = {
	failed: "bg-rose-500",
	queued: "bg-sky-500",
	running: "bg-amber-500 animate-pulse",
	succeeded: "bg-emerald-500",
};

const scenarioStatusDot = {
	draft: "bg-muted-foreground/40",
	failed: "bg-rose-500",
	queued: "bg-sky-500",
	ready: "bg-emerald-500",
	running: "bg-amber-500 animate-pulse",
} as const;

const runFilterOptions: { id: RunFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "live", label: "Live" },
	{ id: "ready", label: "Ready" },
	{ id: "failed", label: "Failed" },
];

function matchesRunFilter(
	status: ScenarioRunRecord["status"],
	filter: RunFilter
) {
	if (filter === "all") {
		return true;
	}
	if (filter === "live") {
		return status === "queued" || status === "running";
	}
	if (filter === "ready") {
		return status === "succeeded";
	}
	return status === "failed";
}

function formatScenarioDuration(params: ScenarioRecord["params"]) {
	const duration =
		typeof params?.duration === "number"
			? params.duration
			: Number(params?.duration);
	if (Number.isFinite(duration) && duration > 0) {
		return `${duration.toFixed(duration % 1 === 0 ? 0 : 1)}s`;
	}
	const frameRateValue =
		params?.framesPerSecond ?? params?.frameRate ?? params?.fps;
	const frameRate =
		typeof frameRateValue === "number"
			? frameRateValue
			: Number(frameRateValue);
	const numFramesValue = params?.numFrames;
	const numFrames =
		typeof numFramesValue === "number"
			? numFramesValue
			: Number(numFramesValue);
	if (
		Number.isFinite(frameRate) &&
		Number.isFinite(numFrames) &&
		frameRate > 0
	) {
		return `${(numFrames / frameRate).toFixed(1)}s`;
	}
	return "n/a";
}

function createRunDraft(scenarioId: string): RunDraft {
	return {
		inputImageUrl: "",
		inputPersonGenerationId: null,
		inputPersonId: null,
		loraPersonId: null,
		scenarioId,
		uploadStorage: null,
	};
}

function buildLaunchInput({
	draft,
	inputImageUrl,
	requiresInputImage,
	scenario,
}: {
	draft: RunDraft;
	inputImageUrl: string;
	requiresInputImage: boolean;
	scenario: ScenarioRecord;
}): LaunchRunInput {
	const launchInput: LaunchRunInput = { scenarioId: scenario.id };
	if (requiresInputImage) {
		launchInput.inputImageUrl = inputImageUrl;
	}
	if (draft.inputPersonId) {
		launchInput.inputPersonId = draft.inputPersonId;
	}
	if (draft.inputPersonGenerationId) {
		launchInput.inputPersonGenerationId = draft.inputPersonGenerationId;
	}
	if (draft.loraPersonId) {
		launchInput.loraPersonId = draft.loraPersonId;
	}
	const promptOverride = draft.promptOverride?.trim();
	if (promptOverride && promptOverride !== scenario.prompt) {
		launchInput.promptOverride = promptOverride;
	}
	return launchInput;
}

function workflowSupportsPersonLora(workflow: WorkflowDefinition | null) {
	return Boolean(
		workflow?.parameters.some((parameter) => parameter.key === "loraUrl")
	);
}

function getLatestScenarioInputImage(
	runs: ScenarioRunRecord[],
	scenarioId: string
) {
	return runs.find((run) => run.scenarioId === scenarioId)?.inputImageUrl ?? "";
}

function getRecentReferenceOptions(
	runs: ScenarioRunRecord[],
	selectedScenarioId: string | null
) {
	const uniqueUrls = new Set<string>();
	return runs
		.filter((run) => run.inputImageUrl.length > 0)
		.sort((left, right) => {
			if (
				left.scenarioId === selectedScenarioId &&
				right.scenarioId !== selectedScenarioId
			) {
				return -1;
			}
			if (
				right.scenarioId === selectedScenarioId &&
				left.scenarioId !== selectedScenarioId
			) {
				return 1;
			}
			return right.createdAt.localeCompare(left.createdAt);
		})
		.filter((run) => {
			if (uniqueUrls.has(run.inputImageUrl)) {
				return false;
			}
			uniqueUrls.add(run.inputImageUrl);
			return true;
		})
		.slice(0, 16);
}

function getStorageLabel(
	storage: UploadedInputAsset["storage"] | null | undefined
) {
	switch (storage) {
		case "s3":
			return "Shared input";
		case "local":
			return "Local input";
		default:
			return null;
	}
}

async function findPersonSlugByOperatorRunId(operatorRunId: string) {
	const payload = await requestJson<{ person: { slug: string } }>(
		`${personsApiBaseUrl}/api/persons/lookup/run/${operatorRunId}`,
		{ cache: "no-store" }
	);
	return payload.person.slug;
}

async function copyValueToClipboard(value: string) {
	if (typeof navigator !== "undefined" && navigator.clipboard) {
		await navigator.clipboard.writeText(value);
		return;
	}
	throw new Error("Clipboard API is not available.");
}

function StatusPill({ status }: { status: ScenarioRunRecord["status"] }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
				runStatusTone[status]
			)}
		>
			<span
				aria-hidden="true"
				className={cn("size-1.5 rounded-full", runStatusDot[status])}
			/>
			{status}
		</span>
	);
}

function ScenarioSwitcherItemActions({
	isActive,
	onDelete,
	onEdit,
	scenario,
}: {
	isActive: boolean;
	onDelete?: (scenarioId: string) => void;
	onEdit?: (scenarioId: string) => void;
	scenario: ScenarioCardData;
}) {
	if (!(onEdit || onDelete)) {
		return null;
	}

	return (
		<div className="absolute top-1 right-1 hidden items-center gap-0.5 group-focus-within/scenario:flex group-hover/scenario:flex">
			{onEdit ? (
				<button
					aria-label={`Edit ${scenario.name}`}
					className={cn(
						"inline-flex size-6 items-center justify-center rounded-md transition",
						isActive
							? "text-background/80 hover:bg-background/10"
							: "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
					)}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onEdit(scenario.id);
					}}
					title="Edit scenario"
					type="button"
				>
					<Pencil className="size-3" />
				</button>
			) : null}
			{onDelete ? (
				<button
					aria-label={`Delete ${scenario.name}`}
					className={cn(
						"inline-flex size-6 items-center justify-center rounded-md transition",
						isActive
							? "text-background/80 hover:bg-rose-500/20"
							: "text-muted-foreground hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400"
					)}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onDelete(scenario.id);
					}}
					title="Delete scenario"
					type="button"
				>
					<Trash2 className="size-3" />
				</button>
			) : null}
		</div>
	);
}

function ScenarioSwitcherItem({
	getScenarioHref,
	isActive,
	onDelete,
	onEdit,
	onPick,
	scenario,
}: {
	getScenarioHref: (scenarioId: string) => Route;
	isActive: boolean;
	onDelete?: (scenarioId: string) => void;
	onEdit?: (scenarioId: string) => void;
	onPick: (scenarioId: string) => void;
	scenario: ScenarioCardData;
}) {
	return (
		<li className="group/scenario relative">
			<a
				aria-current={isActive ? "true" : undefined}
				className={cn(
					"flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition",
					isActive
						? "bg-foreground text-background"
						: "hover:bg-muted/20 dark:hover:bg-muted/10"
				)}
				href={getScenarioHref(scenario.id)}
				onClick={() => onPick(scenario.id)}
			>
				<span
					aria-hidden="true"
					className={cn(
						"mt-1 size-2 shrink-0 rounded-full",
						scenarioStatusDot[scenario.status]
					)}
				/>
				<div className="min-w-0 flex-1">
					<p
						className={cn(
							"truncate font-medium text-xs leading-tight",
							isActive ? "text-background" : "text-foreground"
						)}
					>
						{scenario.name}
					</p>
					<p
						className={cn(
							"mt-0.5 line-clamp-1 text-[10px] leading-tight",
							isActive ? "text-background/65" : "text-muted-foreground"
						)}
					>
						{scenario.prompt || scenario.workflowKey}
					</p>
					<div
						className={cn(
							"mt-0.5 flex items-center gap-2 text-[10px]",
							isActive ? "text-background/60" : "text-muted-foreground/80"
						)}
					>
						<span className="truncate">{scenario.workflowKey}</span>
						<span className="inline-flex items-center gap-0.5">
							<Clock3 className="size-2.5" />
							{scenario.duration}
						</span>
						<span className="inline-flex items-center gap-0.5">
							<Activity className="size-2.5" />
							{scenario.runCount}
						</span>
					</div>
				</div>
			</a>
			<ScenarioSwitcherItemActions
				isActive={isActive}
				onDelete={onDelete}
				onEdit={onEdit}
				scenario={scenario}
			/>
		</li>
	);
}

function CastLoraInline({
	onSelect,
	persons,
	selectedPersonId,
}: {
	onSelect: (personId: string | null) => void;
	persons: PersonRecord[];
	selectedPersonId: string | null;
}) {
	const trainable = persons.filter((person) => Boolean(person.loraUrl));
	const selected = persons.find((p) => p.id === selectedPersonId) ?? null;

	if (trainable.length === 0 && !selected) {
		return (
			<div className="flex items-center gap-2 rounded-md bg-muted/15 px-2 py-1.5 text-[10px] text-muted-foreground">
				<UsersRound className="size-3 shrink-0" />
				<span className="min-w-0 truncate">
					No trained Cast LoRAs available.
				</span>
			</div>
		);
	}

	return (
		<div className="grid gap-1.5">
			<div className="flex items-center justify-between gap-2 px-0.5">
				<span className="text-[10px] text-muted-foreground uppercase tracking-wide">
					Cast LoRA
				</span>
				{selected ? (
					<button
						className="text-[10px] text-muted-foreground underline transition hover:text-foreground"
						onClick={() => onSelect(null)}
						type="button"
					>
						Clear
					</button>
				) : (
					<span className="text-[10px] text-muted-foreground/70">optional</span>
				)}
			</div>
			<div className="flex max-w-full gap-1 overflow-x-auto pb-1">
				<button
					aria-pressed={selectedPersonId === null}
					className={cn(
						"flex size-10 shrink-0 items-center justify-center rounded-md border transition",
						selectedPersonId === null
							? "border-foreground bg-foreground/10"
							: "border-foreground/10 hover:bg-muted/15"
					)}
					onClick={() => onSelect(null)}
					title="No Cast LoRA"
					type="button"
				>
					<UsersRound className="size-3.5 text-muted-foreground" />
				</button>
				{trainable.map((person) => {
					const thumb = person.photoUrl ?? person.referencePhotoUrl ?? null;
					const isActive = person.id === selectedPersonId;
					return (
						<button
							aria-pressed={isActive}
							className={cn(
								"relative size-10 shrink-0 overflow-hidden rounded-md border transition",
								isActive
									? "border-foreground ring-1 ring-foreground"
									: "border-foreground/10 opacity-80 hover:opacity-100"
							)}
							key={person.id}
							onClick={() => onSelect(person.id)}
							title={person.name}
							type="button"
						>
							{thumb ? (
								<div
									aria-hidden="true"
									className="absolute inset-0 bg-center bg-cover"
									style={{ backgroundImage: `url("${thumb}")` }}
								/>
							) : (
								<UserRound className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/60" />
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function ScenarioSwitcher({
	castLoraSlot,
	getScenarioHref,
	onCreateScenario,
	onDeleteScenario,
	onEditScenario,
	onSelect,
	personLoraSelected,
	scenarios,
	selectedScenarioId,
}: {
	castLoraSlot: React.ReactNode;
	getScenarioHref: (scenarioId: string) => Route;
	onCreateScenario?: () => void;
	onDeleteScenario?: (scenarioId: string) => void;
	onEditScenario?: (scenarioId: string) => void;
	onSelect: (scenarioId: string) => void;
	personLoraSelected: PersonRecord | null;
	scenarios: ScenarioCardData[];
	selectedScenarioId: string | null;
}) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const selected =
		scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return scenarios;
		}
		return scenarios.filter(
			(scenario) =>
				scenario.name.toLowerCase().includes(normalized) ||
				scenario.workflowKey.toLowerCase().includes(normalized) ||
				scenario.prompt.toLowerCase().includes(normalized)
		);
	}, [query, scenarios]);

	const personThumb =
		personLoraSelected?.photoUrl ??
		personLoraSelected?.referencePhotoUrl ??
		null;

	return (
		<div className="flex min-w-0 items-center gap-1">
			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger
					render={
						<button
							className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/15"
							type="button"
						>
							{selected ? (
								<span
									aria-hidden="true"
									className={cn(
										"size-2 shrink-0 rounded-full",
										scenarioStatusDot[selected.status]
									)}
								/>
							) : (
								<Layers
									aria-hidden="true"
									className="size-3.5 shrink-0 text-muted-foreground/60"
								/>
							)}
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-xs leading-tight">
									{selected?.name ?? "Pick scenario"}
								</p>
								<p className="truncate text-[10px] text-muted-foreground">
									{selected
										? `${selected.workflowKey} · ${selected.duration} · ${selected.runCount} runs`
										: `${scenarios.length} scenarios`}
								</p>
							</div>
							{personLoraSelected ? (
								<span
									className="relative size-6 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/30"
									title={`Cast: ${personLoraSelected.name}`}
								>
									<span className="sr-only">
										Cast LoRA: {personLoraSelected.name}
									</span>
									{personThumb ? (
										<span
											aria-hidden="true"
											className="absolute inset-0 bg-center bg-cover"
											style={{ backgroundImage: `url("${personThumb}")` }}
										/>
									) : (
										<UserRound className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
									)}
								</span>
							) : null}
							<ChevronDown
								aria-hidden="true"
								className={cn(
									"size-3.5 shrink-0 text-muted-foreground transition-transform",
									open && "rotate-180"
								)}
							/>
						</button>
					}
				/>
				<PopoverContent className="flex max-h-[60vh] w-(--anchor-width) min-w-72 flex-col gap-2 p-2">
					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							aria-label="Search scenarios"
							className="h-8 pl-7 text-xs"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search by name, workflow, prompt"
							value={query}
						/>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						{filtered.length === 0 ? (
							<p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
								{scenarios.length === 0
									? "No scenarios yet."
									: "No matches found."}
							</p>
						) : (
							<ul className="grid gap-0.5">
								{filtered.map((scenario) => (
									<ScenarioSwitcherItem
										getScenarioHref={getScenarioHref}
										isActive={scenario.id === selectedScenarioId}
										key={scenario.id}
										onDelete={
											onDeleteScenario
												? (id) => {
														setOpen(false);
														onDeleteScenario(id);
													}
												: undefined
										}
										onEdit={
											onEditScenario
												? (id) => {
														setOpen(false);
														onEditScenario(id);
													}
												: undefined
										}
										onPick={(id) => {
											onSelect(id);
											setOpen(false);
										}}
										scenario={scenario}
									/>
								))}
							</ul>
						)}
					</div>
					{castLoraSlot ? (
						<div className="border-foreground/8 border-t pt-2">
							{castLoraSlot}
						</div>
					) : null}
					{onCreateScenario ? (
						<Button
							onClick={() => {
								setOpen(false);
								onCreateScenario();
							}}
							size="sm"
							variant="outline"
						>
							<Plus className="size-3.5" />
							New scenario
						</Button>
					) : null}
				</PopoverContent>
			</Popover>
			{selected && onEditScenario ? (
				<IconButton
					hint="Edit scenario"
					label="Edit scenario"
					onClick={() => onEditScenario(selected.id)}
				>
					<Pencil className="size-3.5" />
				</IconButton>
			) : null}
			{selected && onDeleteScenario ? (
				<IconButton
					hint="Delete scenario"
					label="Delete scenario"
					onClick={() => onDeleteScenario(selected.id)}
				>
					<Trash2 className="size-3.5" />
				</IconButton>
			) : null}
			{onCreateScenario ? (
				<IconButton
					hint="Compose new scenario"
					label="New scenario"
					onClick={onCreateScenario}
				>
					<Plus className="size-3.5" />
				</IconButton>
			) : null}
		</div>
	);
}

function runProgressCaption(run: ScenarioRunRecord, pct: unknown): string {
	if (run.status === "queued") {
		return "Starting…";
	}
	if (typeof pct === "number" && Number.isFinite(pct)) {
		return `${Math.round(pct)}%`;
	}
	return "Generating…";
}

function RunLiveProgress({ run }: { run: ScenarioRunRecord }) {
	if (run.status !== "queued" && run.status !== "running") {
		return null;
	}
	const pct = run.progressPct;
	return (
		<div className="space-y-1">
			<div className="h-1 overflow-hidden rounded-full bg-muted/50">
				{typeof pct === "number" && Number.isFinite(pct) ? (
					<div
						className="h-full rounded-full bg-sky-500/85 transition-[width] duration-500"
						style={{
							width: `${Math.min(100, Math.max(0, pct))}%`,
						}}
					/>
				) : (
					<div className="h-full w-full animate-pulse rounded-full bg-muted-foreground/20" />
				)}
			</div>
			<p className="text-[10px] text-muted-foreground">
				{runProgressCaption(run, pct)}
			</p>
		</div>
	);
}

function RunCard({
	isCopied,
	isFocused,
	linkedPerson,
	onCopyRunId,
	personsUrl,
	run,
}: {
	isCopied: boolean;
	isFocused: boolean;
	linkedPerson: LinkedPersonState;
	onCopyRunId: (runId: string) => Promise<void> | void;
	personsUrl: string;
	run: ScenarioRunRecord;
}) {
	const outputThumbnails = run.artifactUrls
		.filter((url) => getMediaType(url) === "image")
		.slice(0, 3);
	const hasLinkedPerson =
		linkedPerson &&
		(linkedPerson.runId === run.id || linkedPerson.runId === run.providerJobId);

	return (
		<article
			className={cn(
				"grid min-w-0 gap-2 rounded-lg bg-muted/8 p-2.5 transition dark:bg-muted/5",
				isFocused && "ring-1 ring-foreground/30"
			)}
		>
			<div className="flex min-w-0 items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[11px]">{run.scenarioName}</p>
					<p className="truncate text-[10px] text-muted-foreground">
						{formatRelativeTime(run.createdAt)} ·{" "}
						{run.providerJobId ?? "pending"}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<StatusPill status={run.status} />
					<IconButton
						hint={isCopied ? "Copied" : "Copy run id"}
						label="Copy run id"
						onClick={() => onCopyRunId(run.id)}
					>
						{isCopied ? (
							<Check className="size-3 text-emerald-500" />
						) : (
							<Copy className="size-3" />
						)}
					</IconButton>
				</div>
			</div>

			{outputThumbnails.length > 0 ? (
				<div className="grid grid-cols-3 gap-1">
					{outputThumbnails.map((url, index) => (
						<a
							aria-label={`Open output ${index + 1}`}
							className="group relative aspect-square overflow-hidden rounded-md bg-black/30"
							href={url}
							key={url}
							rel="noopener noreferrer"
							target="_blank"
						>
							<div
								aria-hidden="true"
								className="absolute inset-0 bg-center bg-cover transition group-hover:scale-105"
								style={{ backgroundImage: `url("${url}")` }}
							/>
							<span className="sr-only">Open output {index + 1}</span>
						</a>
					))}
				</div>
			) : null}

			<RunLiveProgress run={run} />

			{run.errorSummary ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<p
								className="line-clamp-2 cursor-help break-words rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] text-rose-700 [overflow-wrap:anywhere] dark:text-rose-300"
								title={run.errorSummary}
							>
								{run.errorSummary}
							</p>
						}
					/>
					<TooltipContent className="max-w-sm break-words leading-relaxed [overflow-wrap:anywhere]">
						{run.errorSummary}
					</TooltipContent>
				</Tooltip>
			) : null}

			<div className="flex flex-wrap items-center gap-1">
				<Link
					className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
					href={`/run/${run.id}` as Route}
				>
					Debug
				</Link>
				{hasLinkedPerson ? (
					<a
						className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
						href={`${personsUrl}/person/${linkedPerson.personSlug}`}
						rel="noreferrer noopener"
					>
						Person
						<ExternalLink className="size-2.5" />
					</a>
				) : null}
				{run.inputImageUrl ? (
					<a
						className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
						href={run.inputImageUrl}
						rel="noreferrer noopener"
						target="_blank"
					>
						Source
						<ExternalLink className="size-2.5" />
					</a>
				) : null}
			</div>
		</article>
	);
}

function PromptOverrideEditor({
	draft,
	onDraftChange,
	scenario,
}: {
	draft: RunDraft | null;
	onDraftChange: (next: RunDraft) => void;
	scenario: ScenarioRecord;
}) {
	const overrideValue = draft?.promptOverride;
	const promptValue = overrideValue ?? scenario.prompt;
	const hasOverride =
		typeof overrideValue === "string" && overrideValue !== scenario.prompt;
	const hasInputImage = Boolean(draft?.inputImageUrl?.trim());

	function setPrompt(next: string) {
		onDraftChange({
			...(draft ?? createRunDraft(scenario.id)),
			promptOverride: next === scenario.prompt ? undefined : next,
			scenarioId: scenario.id,
		});
	}

	function resetOverride() {
		onDraftChange({
			...(draft ?? createRunDraft(scenario.id)),
			promptOverride: undefined,
			scenarioId: scenario.id,
		});
	}

	if (!scenario.prompt) {
		return (
			<p className="text-[11px] text-muted-foreground italic">
				No prompt set. Open Compose to add one.
			</p>
		);
	}

	return (
		<div className="grid min-w-0 gap-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] text-muted-foreground uppercase tracking-wide">
					Prompt for this run
				</span>
				<div className="flex items-center gap-1">
					{hasOverride ? (
						<button
							className="inline-flex items-center gap-1 text-[10px] text-muted-foreground underline transition hover:text-foreground"
							onClick={resetOverride}
							type="button"
						>
							<RotateCcw className="size-2.5" />
							Reset
						</button>
					) : null}
					<EnhancePromptButton
						className="h-6 px-2 text-[10px]"
						enhance={async (value) => {
							const result = await enhanceStudioPrompt(value, {
								imageUrl: draft?.inputImageUrl ?? null,
							});
							if (result.notice) {
								toast.warning(result.notice);
							} else if (result.mode === "vision") {
								toast.success("Prompt rewritten for this image");
							} else {
								toast.success("Prompt enhanced with Grok");
							}
							return result.enhanced;
						}}
						label={hasInputImage ? "Enhance for image" : "Enhance"}
						onEnhanced={(enhanced) => setPrompt(enhanced)}
						onError={(message) => toast.error(message)}
						prompt={promptValue}
						tooltip={
							hasInputImage
								? "Rewrite this prompt grounded in the input image (Grok vision)"
								: "Rewrite this prompt with Grok"
						}
					/>
				</div>
			</div>
			<textarea
				className="min-h-16 w-full resize-y rounded-lg border border-input bg-background/45 px-2 py-1.5 text-[11px] leading-snug outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
				onChange={(event) => setPrompt(event.target.value)}
				placeholder={scenario.prompt}
				value={promptValue}
			/>
			{hasOverride ? (
				<p className="text-[10px] text-amber-600 dark:text-amber-400">
					Using a per-run prompt override. Reset to use scenario default.
				</p>
			) : null}
		</div>
	);
}

function LaunchSection({
	activeRunCount,
	draft,
	isReadyToLaunch,
	isSubmitting,
	onDraftChange,
	onLaunch,
	recentReferences,
	requiresInputImage,
	scenario,
	shots,
	storageLabel,
}: {
	activeRunCount: number;
	draft: RunDraft | null;
	isReadyToLaunch: boolean;
	isSubmitting: boolean;
	onDraftChange: (next: RunDraft) => void;
	onLaunch: () => void;
	recentReferences: { id: string; label: string; url: string }[];
	requiresInputImage: boolean;
	scenario: ScenarioRecord;
	shots: AdminSnapshot["shots"];
	storageLabel: string | null;
}) {
	return (
		<section className="grid min-w-0 gap-2 border-foreground/6 border-b px-3 py-2.5 dark:border-foreground/10">
			<div className="flex items-center justify-between gap-2">
				<SectionLabel>Launch</SectionLabel>
				<div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
					<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5">
						{scenario.workflowKey}
					</span>
					<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5">
						{formatScenarioDuration(scenario.params)}
					</span>
					{activeRunCount > 0 ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
							<span className="size-1 animate-pulse rounded-full bg-amber-500" />
							{activeRunCount}
						</span>
					) : null}
				</div>
			</div>
			{activeRunCount > 0 ? (
				<p className="text-[10px] text-muted-foreground">
					Status and previews refresh automatically while runs are active.
				</p>
			) : null}

			{requiresInputImage ? (
				<PersonsInputPicker
					currentUrl={draft?.inputImageUrl ?? ""}
					onPick={(pick) => {
						onDraftChange({
							...(draft ?? createRunDraft(scenario.id)),
							inputImageUrl: pick.url,
							inputPersonGenerationId: pick.personGenerationId ?? null,
							inputPersonId: pick.personId ?? null,
							scenarioId: scenario.id,
							uploadStorage: pick.storage ?? null,
						});
					}}
					recentReferences={recentReferences}
					shots={shots}
					storageLabel={storageLabel}
				/>
			) : null}

			<PromptOverrideEditor
				draft={draft}
				onDraftChange={onDraftChange}
				scenario={scenario}
			/>

			<Button
				disabled={!isReadyToLaunch || isSubmitting}
				onClick={onLaunch}
				size="sm"
			>
				{isSubmitting ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<Play className="size-3.5" />
				)}
				{requiresInputImage && !isReadyToLaunch
					? "Add an input image"
					: "Launch run"}
			</Button>
		</section>
	);
}

function RunFilterPills({
	counts,
	onChange,
	value,
}: {
	counts: Record<RunFilter, number>;
	onChange: (next: RunFilter) => void;
	value: RunFilter;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1">
			{runFilterOptions.map((option) => {
				const count = counts[option.id];
				const isActive = value === option.id;
				const isDisabled = count === 0 && option.id !== "all";
				return (
					<button
						aria-pressed={isActive}
						className={cn(
							"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide transition",
							isActive
								? "bg-foreground text-background"
								: "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
							isDisabled && "opacity-40"
						)}
						disabled={isDisabled}
						key={option.id}
						onClick={() => onChange(option.id)}
						type="button"
					>
						{option.label}
						<span className="tabular-nums">{count}</span>
					</button>
				);
			})}
		</div>
	);
}

function ActivitySection({
	copiedRunId,
	filter,
	filteredRuns,
	focusedRunId,
	linkedPerson,
	onCopyRunId,
	onFilterChange,
	personsUrl,
	scenarioRuns,
}: {
	copiedRunId: string | null;
	filter: RunFilter;
	filteredRuns: ScenarioRunRecord[];
	focusedRunId: string | null;
	linkedPerson: LinkedPersonState;
	onCopyRunId: (runId: string) => Promise<void> | void;
	onFilterChange: (next: RunFilter) => void;
	personsUrl: string;
	scenarioRuns: ScenarioRunRecord[];
}) {
	const counts = useMemo<Record<RunFilter, number>>(
		() => ({
			all: scenarioRuns.length,
			failed: scenarioRuns.filter((run) => run.status === "failed").length,
			live: scenarioRuns.filter(
				(run) => run.status === "queued" || run.status === "running"
			).length,
			ready: scenarioRuns.filter((run) => run.status === "succeeded").length,
		}),
		[scenarioRuns]
	);

	return (
		<section className="flex min-w-0 flex-col">
			<div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2">
				<div className="flex shrink-0 items-center gap-1.5">
					<SectionLabel>Activity</SectionLabel>
					<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
						{scenarioRuns.length}
					</span>
				</div>
				<RunFilterPills
					counts={counts}
					onChange={onFilterChange}
					value={filter}
				/>
			</div>

			<div className="min-w-0 px-3 pb-3">
				{filteredRuns.length === 0 ? (
					<EmptyState
						hint={
							scenarioRuns.length === 0
								? "Launch a run to see it here."
								: "Switch the filter to see other runs."
						}
						message={
							scenarioRuns.length === 0 ? "No runs yet." : `No ${filter} runs.`
						}
					/>
				) : (
					<div className="grid min-w-0 gap-2">
						{filteredRuns.map((run) => (
							<RunCard
								isCopied={copiedRunId === run.id}
								isFocused={
									focusedRunId === run.id || focusedRunId === run.providerJobId
								}
								key={run.id}
								linkedPerson={linkedPerson}
								onCopyRunId={onCopyRunId}
								personsUrl={personsUrl}
								run={run}
							/>
						))}
					</div>
				)}
			</div>
		</section>
	);
}

export default function CommandSidebar({
	className,
	getScenarioHref,
	onCreateScenario,
	onDeleteScenario,
	onEditScenario,
	onSnapshotChange,
	scenarioCards,
	selectedScenarioId,
	snapshot: initialSnapshot,
}: CommandSidebarProps) {
	const [snapshot, setSnapshot] = useState<AdminSnapshot>(initialSnapshot);
	const [runDrafts, setRunDrafts] = useState<Record<string, RunDraft>>({});
	const [submittingRunId, setSubmittingRunId] = useState<string | null>(null);
	const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
	const [linkedPerson, setLinkedPerson] = useState<LinkedPersonState>(null);
	const [runFilter, setRunFilter] = useState<RunFilter>("all");
	const [studioPersons, setStudioPersons] = useState<PersonRecord[]>([]);
	const router = useRouter();
	const searchParams = useSearchParams();
	const focusedRunId = searchParams.get("run");
	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";

	const runs = snapshot.runs;
	const scenarios = snapshot.scenarios;
	const workflows = snapshot.workflows;
	const selectedScenario =
		scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
	const selectedScenarioRuns = useMemo(() => {
		if (!selectedScenarioId) {
			return runs.slice(0, 12);
		}
		return runs.filter((run) => run.scenarioId === selectedScenarioId);
	}, [runs, selectedScenarioId]);
	const filteredRuns = useMemo(
		() =>
			selectedScenarioRuns.filter((run) =>
				matchesRunFilter(run.status, runFilter)
			),
		[runFilter, selectedScenarioRuns]
	);
	const recentReferences = useMemo(
		() =>
			getRecentReferenceOptions(runs, selectedScenarioId).map((run) => ({
				id: run.id,
				label: run.inputLabel,
				url: run.inputImageUrl,
			})),
		[runs, selectedScenarioId]
	);
	const selectedRunDraft = selectedScenario
		? (runDrafts[selectedScenario.id] ?? createRunDraft(selectedScenario.id))
		: null;
	const selectedScenarioWorkflow = selectedScenario
		? (workflows.find(
				(workflow) => workflow.key === selectedScenario.workflowKey
			) ?? null)
		: null;
	const activeRunCount = selectedScenarioRuns.filter(
		(run) => run.status === "queued" || run.status === "running"
	).length;

	useEffect(() => {
		setSnapshot(initialSnapshot);
		setRunDrafts((current) => {
			const nextDrafts = { ...current };
			for (const scenario of initialSnapshot.scenarios) {
				nextDrafts[scenario.id] ??= createRunDraft(scenario.id);
				nextDrafts[scenario.id] = {
					...nextDrafts[scenario.id],
					inputImageUrl:
						nextDrafts[scenario.id].inputImageUrl ||
						getLatestScenarioInputImage(initialSnapshot.runs, scenario.id),
					scenarioId: scenario.id,
				};
			}
			return nextDrafts;
		});
	}, [initialSnapshot]);

	useEffect(() => {
		const targetRunId = focusedRunId;
		if (!targetRunId) {
			setLinkedPerson(null);
			return;
		}
		let isMounted = true;
		findPersonSlugByOperatorRunId(targetRunId)
			.then((personSlug) => {
				if (!isMounted) {
					return;
				}
				setLinkedPerson({ personSlug, runId: targetRunId });
			})
			.catch(() => {
				if (!isMounted) {
					return;
				}
				setLinkedPerson(null);
			});
		return () => {
			isMounted = false;
		};
	}, [focusedRunId]);

	useEffect(() => {
		listPersons()
			.then((result) => {
				setStudioPersons(result.persons);
			})
			.catch(() => {
				setStudioPersons([]);
			});
	}, []);

	useEffect(() => {
		if (!(selectedScenarioId && selectedScenarioWorkflow)) {
			return;
		}
		if (workflowSupportsPersonLora(selectedScenarioWorkflow)) {
			return;
		}
		setRunDrafts((current) => {
			const draft = current[selectedScenarioId];
			if (!draft?.loraPersonId) {
				return current;
			}
			return {
				...current,
				[selectedScenarioId]: { ...draft, loraPersonId: null },
			};
		});
	}, [selectedScenarioId, selectedScenarioWorkflow]);

	async function handleCopyRunId(runId: string) {
		try {
			await copyValueToClipboard(runId);
			setCopiedRunId(runId);
			setTimeout(() => {
				setCopiedRunId((current) => (current === runId ? null : current));
			}, 1500);
		} catch {
			toast.error("Unable to copy.");
		}
	}

	async function handleLaunchRun(scenario: ScenarioRecord) {
		const draft = runDrafts[scenario.id] ?? createRunDraft(scenario.id);
		const workflow =
			workflows.find((item) => item.key === scenario.workflowKey) ?? null;
		const requiresInputImage = Boolean(workflow?.requiresInputImage);
		const inputImageUrl = draft.inputImageUrl?.trim() ?? "";

		if (requiresInputImage && !inputImageUrl) {
			toast.error("Upload an image or paste a URL first.");
			return;
		}

		setSubmittingRunId(scenario.id);
		try {
			const launchInput = buildLaunchInput({
				draft,
				inputImageUrl,
				requiresInputImage,
				scenario,
			});
			const result = await launchStudioRun(launchInput);
			setSnapshot((current) => {
				const next = {
					...current,
					runs: [result.data, ...current.runs],
				};
				onSnapshotChange?.(next);
				return next;
			});
			setRunDrafts((current) => ({
				...current,
				[scenario.id]: {
					...createRunDraft(scenario.id),
					inputImageUrl: result.data.inputImageUrl,
					loraPersonId: draft.loraPersonId ?? null,
					promptOverride: undefined,
				},
			}));
			toast.success("Run queued.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to launch run."
			);
		} finally {
			setSubmittingRunId(null);
		}
	}

	function selectScenario(scenarioId: string) {
		router.replace(getScenarioHref(scenarioId), { scroll: false });
	}

	const requiresInputImage = Boolean(
		selectedScenarioWorkflow?.requiresInputImage
	);
	const isReadyToLaunch =
		selectedScenario !== null &&
		(!requiresInputImage || Boolean(selectedRunDraft?.inputImageUrl?.trim()));
	const storageLabel = getStorageLabel(selectedRunDraft?.uploadStorage ?? null);

	const supportsPersonLora =
		Boolean(selectedScenario) &&
		workflowSupportsPersonLora(selectedScenarioWorkflow);
	const selectedPersonLora = supportsPersonLora
		? (studioPersons.find(
				(person) => person.id === selectedRunDraft?.loraPersonId
			) ?? null)
		: null;

	function handleSelectPersonLora(personId: string | null) {
		if (!selectedScenario) {
			return;
		}
		setRunDrafts((current) => ({
			...current,
			[selectedScenario.id]: {
				...(current[selectedScenario.id] ??
					createRunDraft(selectedScenario.id)),
				loraPersonId: personId,
				scenarioId: selectedScenario.id,
			},
		}));
	}

	return (
		<aside
			className={cn(
				"studio-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
				className
			)}
		>
			<header className="flex shrink-0 flex-col border-foreground/6 border-b dark:border-foreground/10">
				<div className="flex min-w-0 items-center gap-1 px-2 py-2">
					<div className="min-w-0 flex-1">
						<ScenarioSwitcher
							castLoraSlot={
								supportsPersonLora ? (
									<CastLoraInline
										onSelect={handleSelectPersonLora}
										persons={studioPersons}
										selectedPersonId={selectedRunDraft?.loraPersonId ?? null}
									/>
								) : null
							}
							getScenarioHref={getScenarioHref}
							onCreateScenario={onCreateScenario}
							onDeleteScenario={onDeleteScenario}
							onEditScenario={onEditScenario}
							onSelect={selectScenario}
							personLoraSelected={selectedPersonLora}
							scenarios={scenarioCards}
							selectedScenarioId={selectedScenarioId}
						/>
					</div>
				</div>
			</header>

			<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
				{selectedScenario ? (
					<LaunchSection
						activeRunCount={activeRunCount}
						draft={selectedRunDraft}
						isReadyToLaunch={isReadyToLaunch}
						isSubmitting={submittingRunId === selectedScenario.id}
						onDraftChange={(next) => {
							setRunDrafts((current) => ({
								...current,
								[selectedScenario.id]: next,
							}));
						}}
						onLaunch={() => {
							handleLaunchRun(selectedScenario).catch(() => undefined);
						}}
						recentReferences={recentReferences}
						requiresInputImage={requiresInputImage}
						scenario={selectedScenario}
						shots={snapshot.shots}
						storageLabel={storageLabel}
					/>
				) : (
					<section className="px-3 py-3">
						<EmptyState
							action={
								onCreateScenario ? (
									<Button onClick={onCreateScenario} size="sm">
										<Plus className="size-3.5" />
										Compose scenario
									</Button>
								) : null
							}
							hint="Select or compose a scenario to launch."
							message="No scenario selected."
						/>
					</section>
				)}

				<ActivitySection
					copiedRunId={copiedRunId}
					filter={runFilter}
					filteredRuns={filteredRuns}
					focusedRunId={focusedRunId}
					linkedPerson={linkedPerson}
					onCopyRunId={handleCopyRunId}
					onFilterChange={setRunFilter}
					personsUrl={personsUrl}
					scenarioRuns={selectedScenarioRuns}
				/>
			</div>
		</aside>
	);
}
