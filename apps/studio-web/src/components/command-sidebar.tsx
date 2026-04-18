"use client";

import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import {
	type AdminSnapshot,
	getStudioSnapshot,
	type LaunchRunInput,
	launchStudioRun,
	type ScenarioRecord,
	type ScenarioRunRecord,
	syncStudioRun,
	type UploadedInputAsset,
} from "@generator/studio-client/client";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
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
	Play,
	Plus,
	RefreshCw,
	RotateCw,
	Search,
} from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import IconButton from "@/components/icon-button";
import PersonsInputPicker from "@/components/persons-input-picker";
import { getMediaType } from "@/components/preview-surface";
import type { ScenarioCardData } from "@/components/scenario-card-data";

interface CommandSidebarProps {
	className?: string;
	getScenarioHref: (scenarioId: string) => Route;
	onCreateScenario?: () => void;
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
		scenarioId,
		uploadStorage: null,
	};
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

function ScenarioSwitcherItem({
	getScenarioHref,
	isActive,
	onPick,
	scenario,
}: {
	getScenarioHref: (scenarioId: string) => Route;
	isActive: boolean;
	onPick: (scenarioId: string) => void;
	scenario: ScenarioCardData;
}) {
	return (
		<li>
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
				<div className="relative size-8 shrink-0 overflow-hidden rounded-md bg-muted/20 dark:bg-muted/10">
					{scenario.thumbnailUrl ? (
						<div
							aria-hidden="true"
							className="absolute inset-0 bg-center bg-cover"
							style={{
								backgroundImage: `url("${scenario.thumbnailUrl}")`,
							}}
						/>
					) : (
						<Layers
							aria-hidden="true"
							className={cn(
								"absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2",
								isActive ? "text-background/40" : "text-muted-foreground/40"
							)}
						/>
					)}
					<span
						aria-hidden="true"
						className={cn(
							"absolute right-0.5 bottom-0.5 size-1.5 rounded-full ring-1 ring-background",
							scenarioStatusDot[scenario.status]
						)}
					/>
				</div>
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
		</li>
	);
}

function ScenarioSwitcher({
	getScenarioHref,
	onCreateScenario,
	onSelect,
	scenarios,
	selectedScenarioId,
}: {
	getScenarioHref: (scenarioId: string) => Route;
	onCreateScenario?: () => void;
	onSelect: (scenarioId: string) => void;
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

	return (
		<div className="flex items-center gap-1">
			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger
					render={
						<button
							className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/15"
							type="button"
						>
							<div className="relative size-8 shrink-0 overflow-hidden rounded-md bg-muted/20 dark:bg-muted/10">
								{selected?.thumbnailUrl ? (
									<div
										aria-hidden="true"
										className="absolute inset-0 bg-center bg-cover"
										style={{
											backgroundImage: `url("${selected.thumbnailUrl}")`,
										}}
									/>
								) : (
									<Layers
										aria-hidden="true"
										className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50"
									/>
								)}
								{selected ? (
									<span
										aria-hidden="true"
										className={cn(
											"absolute right-0.5 bottom-0.5 size-1.5 rounded-full ring-1 ring-background",
											scenarioStatusDot[selected.status]
										)}
									/>
								) : null}
							</div>
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

function RunCard({
	isCopied,
	isFocused,
	linkedPerson,
	onCopyRunId,
	onSyncRun,
	personsUrl,
	run,
	syncingRunId,
}: {
	isCopied: boolean;
	isFocused: boolean;
	linkedPerson: LinkedPersonState;
	onCopyRunId: (runId: string) => Promise<void> | void;
	onSyncRun: (runId: string) => Promise<void> | void;
	personsUrl: string;
	run: ScenarioRunRecord;
	syncingRunId: string | null;
}) {
	const outputThumbnails = run.artifactUrls
		.filter((url) => getMediaType(url) === "image")
		.slice(0, 3);
	const isSyncing = syncingRunId === run.id;
	const hasLinkedPerson =
		linkedPerson &&
		(linkedPerson.runId === run.id || linkedPerson.runId === run.providerJobId);

	return (
		<article
			className={cn(
				"grid gap-2 rounded-lg bg-muted/8 p-2.5 transition dark:bg-muted/5",
				isFocused && "ring-1 ring-foreground/30"
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-[11px]">{run.scenarioName}</p>
					<p className="truncate text-[10px] text-muted-foreground">
						{formatRelativeTime(run.createdAt)} ·{" "}
						{run.providerJobId ?? "pending"}
					</p>
				</div>
				<div className="flex items-center gap-1">
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

			{run.errorSummary ? (
				<p className="rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] text-rose-700 dark:text-rose-300">
					{run.errorSummary}
				</p>
			) : null}

			<div className="flex flex-wrap items-center gap-1">
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
				{run.status === "queued" || run.status === "running" ? (
					<Button
						disabled={isSyncing}
						onClick={() => onSyncRun(run.id)}
						size="xs"
						variant="outline"
					>
						{isSyncing ? (
							<Loader2 className="size-3 animate-spin" />
						) : (
							<RotateCw className="size-3" />
						)}
						Sync
					</Button>
				) : null}
			</div>
		</article>
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
		<section className="grid gap-2 border-foreground/6 border-b px-3 py-2.5 dark:border-foreground/10">
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

			{scenario.prompt ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<p className="line-clamp-2 cursor-help text-[11px] leading-snug">
								{scenario.prompt}
							</p>
						}
					/>
					<TooltipContent className="max-w-sm leading-relaxed">
						{scenario.prompt}
					</TooltipContent>
				</Tooltip>
			) : (
				<p className="text-[11px] text-muted-foreground italic">
					No prompt set. Open Compose to add one.
				</p>
			)}

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
	onSyncRun,
	personsUrl,
	scenarioRuns,
	syncingRunId,
}: {
	copiedRunId: string | null;
	filter: RunFilter;
	filteredRuns: ScenarioRunRecord[];
	focusedRunId: string | null;
	linkedPerson: LinkedPersonState;
	onCopyRunId: (runId: string) => Promise<void> | void;
	onFilterChange: (next: RunFilter) => void;
	onSyncRun: (runId: string) => Promise<void> | void;
	personsUrl: string;
	scenarioRuns: ScenarioRunRecord[];
	syncingRunId: string | null;
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
		<section className="flex flex-col">
			<div className="flex items-center justify-between gap-2 px-3 py-2">
				<div className="flex items-center gap-1.5">
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

			<div className="px-3 pb-3">
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
					<div className="grid gap-2">
						{filteredRuns.map((run) => (
							<RunCard
								isCopied={copiedRunId === run.id}
								isFocused={
									focusedRunId === run.id || focusedRunId === run.providerJobId
								}
								key={run.id}
								linkedPerson={linkedPerson}
								onCopyRunId={onCopyRunId}
								onSyncRun={onSyncRun}
								personsUrl={personsUrl}
								run={run}
								syncingRunId={syncingRunId}
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
	onSnapshotChange,
	scenarioCards,
	selectedScenarioId,
	snapshot: initialSnapshot,
}: CommandSidebarProps) {
	const [snapshot, setSnapshot] = useState<AdminSnapshot>(initialSnapshot);
	const [runDrafts, setRunDrafts] = useState<Record<string, RunDraft>>({});
	const [submittingRunId, setSubmittingRunId] = useState<string | null>(null);
	const [syncingRunId, setSyncingRunId] = useState<string | null>(null);
	const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
	const [linkedPerson, setLinkedPerson] = useState<LinkedPersonState>(null);
	const [runFilter, setRunFilter] = useState<RunFilter>("all");
	const [isRefreshing, setIsRefreshing] = useState(false);
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

	const refreshSnapshot = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const next = await getStudioSnapshot();
			setSnapshot(next);
			onSnapshotChange?.(next);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to refresh."
			);
		} finally {
			setIsRefreshing(false);
		}
	}, [onSnapshotChange]);

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

	async function handleSyncRun(runId: string) {
		setSyncingRunId(runId);
		try {
			const result = await syncStudioRun(runId);
			setSnapshot((current) => {
				const next = {
					...current,
					runs: current.runs.map((run) =>
						run.id === runId ? result.data : run
					),
				};
				onSnapshotChange?.(next);
				return next;
			});
			toast.success("Run status refreshed.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to sync run status."
			);
		} finally {
			setSyncingRunId(null);
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

	return (
		<aside
			className={cn(
				"studio-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
				className
			)}
		>
			<header className="flex shrink-0 items-center gap-1 border-foreground/6 border-b px-2 py-2 dark:border-foreground/10">
				<div className="min-w-0 flex-1">
					<ScenarioSwitcher
						getScenarioHref={getScenarioHref}
						onCreateScenario={onCreateScenario}
						onSelect={selectScenario}
						scenarios={scenarioCards}
						selectedScenarioId={selectedScenarioId}
					/>
				</div>
				<IconButton
					hint="Refresh snapshot"
					label="Refresh snapshot"
					onClick={() => {
						refreshSnapshot().catch(() => undefined);
					}}
				>
					{isRefreshing ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<RefreshCw className="size-3.5" />
					)}
				</IconButton>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
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
					onSyncRun={handleSyncRun}
					personsUrl={personsUrl}
					scenarioRuns={selectedScenarioRuns}
					syncingRunId={syncingRunId}
				/>
			</div>
		</aside>
	);
}
