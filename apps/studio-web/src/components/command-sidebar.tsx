"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import type {
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";
import type {
	StudioPromptEnhanceMode,
	StudioPromptSource,
} from "@generator/contracts/studio";
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
} from "@generator/studio-client/client";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { EnhancePromptButton } from "@generator/ui/components/enhance-prompt-button";
import { InfoTooltip } from "@generator/ui/components/info-tooltip";
import { RunProgressIndicator } from "@generator/ui/components/run-progress-indicator";
import { SectionLabel } from "@generator/ui/components/section-label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import {
	Check,
	Copy,
	ExternalLink,
	Loader2,
	Play,
	Plus,
	RotateCcw,
	Sparkles,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getLoraSlots } from "@/components/compose/workflow-matrix";
import { buildFinalPromptPreview } from "@/components/final-prompt-preview";
import IconButton from "@/components/icon-button";
import PersonLaunchSection from "@/components/person-launch-section";
import PersonsInputPicker from "@/components/persons-input-picker";
import { getMediaType } from "@/components/preview-surface";
import type { ScenarioCardData } from "@/components/scenario-card-data";
import SubjectSwitcher from "@/components/subject-switcher";
import { useStudioLoras } from "@/components/use-studio-loras";

interface CommandSidebarProps {
	className?: string;
	getPersonHref: (personId: string) => Route;
	getScenarioHref: (scenarioId: string) => Route;
	onCreateScenario?: (workflowKey?: string) => void;
	onDeleteScenario?: (scenarioId: string) => void | Promise<void>;
	onEditScenario?: (scenarioId: string) => void;
	onPersonRefreshed: (person: PersonRecord) => void;
	onPickPerson: (personId: string) => void;
	onPickScenario: (scenarioId: string) => void;
	onSnapshotChange: (snapshot: AdminSnapshot) => void;
	persons: PersonRecord[];
	scenarioCards: ScenarioCardData[];
	selectedPerson: PersonRecord | null;
	selectedPersonId: string | null;
	selectedScenarioId: string | null;
	snapshot: AdminSnapshot;
	sourceImageTransfer?: SourceImageTransfer | null;
}

type RunFilter = "all" | "live" | "ready" | "failed";

type RunDraft = LaunchRunInput & {
	inputPersonGenerationId?: string | null;
	inputPersonId?: string | null;
	uploadStorage?: UploadedInputAsset["storage"] | null;
};

export interface SourceImageTransfer {
	scenarioId: string;
	url: string;
}

type LinkedPersonState = {
	personSlug: string;
	runId: string;
} | null;

interface ScenarioLoraItem {
	civitaiUrl: string | null;
	id: string;
	name: string;
	slotLabel: string;
	triggerWords: string[];
	variant: LoraRegistryEntry["variant"];
	weight: string | null;
}

const personsApiBaseUrl = normalizeBaseUrl(
	env.NEXT_PUBLIC_PERSONS_API_URL ?? "http://localhost:3003"
);

const civitaiHostPattern = /(^|\.)civitai\.(com|red)$/iu;

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
	const promptOverride = draft.promptOverride?.trim();
	if (promptOverride && promptOverride !== scenario.prompt) {
		launchInput.promptOverride = promptOverride;
		if (draft.promptSource?.enhancedPrompt.trim() === promptOverride) {
			launchInput.promptSource = draft.promptSource;
		}
	}
	return launchInput;
}

function getLatestScenarioInputImage(
	runs: ScenarioRunRecord[],
	scenarioId: string
) {
	return runs.find((run) => run.scenarioId === scenarioId)?.inputImageUrl ?? "";
}

function getRecentReferenceOptions(
	runs: ScenarioRunRecord[]
): { id: string; label: string; url: string }[] {
	const uniqueUrls = new Set<string>();
	const references: { id: string; label: string; url: string }[] = [];
	const sortedRuns = [...runs].sort((left, right) =>
		right.createdAt.localeCompare(left.createdAt)
	);

	for (const run of sortedRuns) {
		for (const [index, url] of run.artifactUrls.entries()) {
			if (getMediaType(url) !== "image" || uniqueUrls.has(url)) {
				continue;
			}
			uniqueUrls.add(url);
			references.push({
				id: `${run.id}:output:${index}`,
				label:
					run.artifactUrls.length > 1
						? `${run.scenarioName} output ${index + 1}`
						: `${run.scenarioName} output`,
				url,
			});
			if (references.length >= 16) {
				return references;
			}
		}
	}

	return references;
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

function isCivitaiUrl(value: string): boolean {
	try {
		return civitaiHostPattern.test(new URL(value).hostname);
	} catch {
		return false;
	}
}

function getCivitaiSourceUrl(entry: LoraRegistryEntry | null, url: string) {
	if (
		entry?.sourceUrl &&
		(entry.sourceProvider === "civitai" || isCivitaiUrl(entry.sourceUrl))
	) {
		return entry.sourceUrl;
	}
	return isCivitaiUrl(url) ? url : null;
}

function getUrlDisplayName(url: string) {
	try {
		const parsed = new URL(url);
		const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
		return lastSegment ? decodeURIComponent(lastSegment) : parsed.hostname;
	} catch {
		return url;
	}
}

function formatLoraWeight(
	params: ScenarioRecord["params"],
	weightKey: string | null
) {
	if (!weightKey) {
		return null;
	}
	const rawWeight = params?.[weightKey];
	const weight =
		typeof rawWeight === "number" ? rawWeight : Number(rawWeight ?? "");
	if (!Number.isFinite(weight)) {
		return null;
	}
	return weight.toFixed(weight % 1 === 0 ? 0 : 2);
}

function getScenarioLoras({
	availableLoras,
	scenario,
	workflow,
}: {
	availableLoras: LoraRegistryEntry[];
	scenario: ScenarioRecord;
	workflow: AdminSnapshot["workflows"][number] | null;
}): ScenarioLoraItem[] {
	if (!workflow) {
		return [];
	}
	const lorasByUrl = new Map(
		availableLoras.map((entry) => [entry.s3Url, entry])
	);
	const slots = getLoraSlots(workflow);
	const items: ScenarioLoraItem[] = [];

	for (const slot of slots) {
		const rawUrl = scenario.params?.[slot.urlKey];
		if (typeof rawUrl !== "string") {
			continue;
		}
		const url = rawUrl.trim();
		if (!url) {
			continue;
		}
		const entry = lorasByUrl.get(url) ?? null;
		items.push({
			civitaiUrl: getCivitaiSourceUrl(entry, url),
			id: `${slot.urlKey}:${url}`,
			name: entry?.name ?? getUrlDisplayName(url),
			slotLabel: slot.label,
			triggerWords: entry?.triggerWords ?? [],
			variant: entry?.variant ?? null,
			weight: formatLoraWeight(scenario.params, slot.weightKey),
		});
	}

	return items;
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

function RunLiveProgress({ run }: { run: ScenarioRunRecord }) {
	if (run.status !== "queued" && run.status !== "running") {
		return null;
	}
	return (
		<RunProgressIndicator
			etaMs={run.etaMs}
			expectedDurationMs={run.expectedDurationMs}
			lastLogLine={run.lastLogLine}
			phase={run.phase}
			progressMonotonicKey={run.id}
			progressPct={run.progressPct}
			queuePosition={run.queuePosition}
			runStartedAt={run.createdAt}
			status={run.status}
		/>
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
							className="group relative aspect-[9/16] overflow-hidden rounded-md bg-black/30"
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
	availableLoras,
	draft,
	onDraftChange,
	requiresInputImage,
	scenario,
	workflow,
}: {
	availableLoras: LoraRegistryEntry[];
	draft: RunDraft | null;
	onDraftChange: (next: RunDraft) => void;
	requiresInputImage: boolean;
	scenario: ScenarioRecord;
	workflow: AdminSnapshot["workflows"][number] | null;
}) {
	const overrideValue = draft?.promptOverride;
	const promptValue = overrideValue ?? scenario.prompt;
	const hasOverride =
		typeof overrideValue === "string" && overrideValue !== scenario.prompt;
	const useVisionEnhance = Boolean(
		requiresInputImage && draft?.inputImageUrl?.trim()
	);
	const promptSourceRef = useRef<{
		mode: StudioPromptEnhanceMode;
		originalPrompt: string;
	} | null>(null);
	const finalPrompt = useMemo(() => {
		if (!workflow) {
			return promptValue;
		}
		return buildFinalPromptPreview({
			availableLoras,
			params: scenario.params ?? {},
			prompt: promptValue,
			workflow,
		});
	}, [availableLoras, promptValue, scenario.params, workflow]);
	const finalPromptPreview = promptValue.trim()
		? finalPrompt
		: "Prompt is empty.";

	function setPrompt(next: string, promptSource?: StudioPromptSource | null) {
		const promptOverride = next === scenario.prompt ? undefined : next;
		onDraftChange({
			...(draft ?? createRunDraft(scenario.id)),
			promptOverride,
			promptSource:
				promptOverride && promptSource?.enhancedPrompt.trim() === promptOverride
					? promptSource
					: undefined,
			scenarioId: scenario.id,
		});
	}

	function resetOverride() {
		onDraftChange({
			...(draft ?? createRunDraft(scenario.id)),
			promptOverride: undefined,
			promptSource: undefined,
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
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-muted-foreground uppercase tracking-wide">
						Prompt for this run
					</span>
					<InfoTooltip
						align="start"
						contentClassName="max-w-[min(34rem,calc(100vw-2rem))] flex-col items-start gap-1.5"
						label="Show final prompt"
						side="top"
					>
						<span className="font-medium">Final prompt</span>
						<span className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4">
							{finalPromptPreview}
						</span>
					</InfoTooltip>
				</div>
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
								imageUrl: useVisionEnhance
									? (draft?.inputImageUrl ?? null)
									: null,
							});
							promptSourceRef.current = {
								mode: result.mode,
								originalPrompt: value,
							};
							if (result.notice) {
								toast.warning(result.notice);
							} else if (result.mode === "vision") {
								toast.success("Prompt rewritten for this image");
							} else {
								toast.success("Prompt enhanced");
							}
							return result.enhanced;
						}}
						label={useVisionEnhance ? "Enhance for image" : "Enhance"}
						onEnhanced={(enhanced) => {
							const source = promptSourceRef.current;
							setPrompt(enhanced, {
								enhancedPrompt: enhanced,
								mode: source?.mode ?? (useVisionEnhance ? "vision" : "text"),
								originalPrompt: source?.originalPrompt ?? promptValue.trim(),
							});
						}}
						onError={(message) => toast.error(message)}
						prompt={promptValue}
						tooltip={
							useVisionEnhance
								? "Rewrite this prompt using the input image (vision)"
								: "Rewrite this prompt with the configured AI provider"
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

function ScenarioLorasFooter({
	availableLoras,
	scenario,
	workflow,
}: {
	availableLoras: LoraRegistryEntry[];
	scenario: ScenarioRecord;
	workflow: AdminSnapshot["workflows"][number] | null;
}) {
	const scenarioLoras = useMemo(
		() => getScenarioLoras({ availableLoras, scenario, workflow }),
		[availableLoras, scenario, workflow]
	);

	if (scenarioLoras.length === 0) {
		return null;
	}

	return (
		<div className="grid min-w-0 gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<Sparkles className="size-3 text-muted-foreground" />
					<SectionLabel>LoRAs</SectionLabel>
				</div>
				<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
					{scenarioLoras.length}
				</span>
			</div>
			<div className="grid min-w-0 gap-1.5">
				{scenarioLoras.map((lora) => (
					<div
						className="flex min-w-0 items-start justify-between gap-2 rounded-md bg-background/45 px-2 py-1.5 ring-1 ring-foreground/6"
						key={lora.id}
					>
						<div className="grid min-w-0 gap-0.5">
							<div className="flex min-w-0 items-center gap-1.5">
								<span className="truncate font-medium text-[11px]">
									{lora.name}
								</span>
								{lora.variant ? (
									<span className="shrink-0 rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[9px] text-muted-foreground uppercase">
										{lora.variant}
									</span>
								) : null}
								{lora.weight ? (
									<span className="shrink-0 rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[9px] text-muted-foreground">
										{lora.weight}x
									</span>
								) : null}
							</div>
							<p className="truncate text-[10px] text-muted-foreground">
								{lora.slotLabel}
								{lora.triggerWords.length > 0
									? ` · ${lora.triggerWords.slice(0, 3).join(", ")}`
									: ""}
							</p>
						</div>
						{lora.civitaiUrl ? (
							<a
								aria-label={`Open ${lora.name} on Civitai`}
								className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/25 hover:text-foreground dark:bg-muted/8"
								href={lora.civitaiUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								Civitai
								<ExternalLink className="size-2.5" />
							</a>
						) : null}
					</div>
				))}
			</div>
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
	workflow,
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
	workflow: AdminSnapshot["workflows"][number] | null;
}) {
	const { loras: availableLoras } = useStudioLoras(
		workflow?.baseModel,
		Boolean(workflow)
	);
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
					imageGenerationsOnly={requiresInputImage}
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
				availableLoras={availableLoras}
				draft={draft}
				onDraftChange={onDraftChange}
				requiresInputImage={requiresInputImage}
				scenario={scenario}
				workflow={workflow}
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

			<ScenarioLorasFooter
				availableLoras={availableLoras}
				scenario={scenario}
				workflow={workflow}
			/>
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
					</button>
				);
			})}
		</div>
	);
}

function ScenarioActivitySection({
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

function PersonActivitySection({ person }: { person: PersonRecord }) {
	const studioGenerations = useMemo(
		() =>
			person.generations.filter(
				(generation) => generation.metadata?.isDatasetPhoto !== true
			),
		[person.generations]
	);
	const ready = studioGenerations.filter(
		(generation) => generation.status === "ready"
	);
	const live = studioGenerations.filter(
		(generation) => generation.status === "queued"
	);

	return (
		<section className="flex min-w-0 flex-col">
			<div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2">
				<div className="flex shrink-0 items-center gap-1.5">
					<SectionLabel>Activity</SectionLabel>
					<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
						{studioGenerations.length}
					</span>
				</div>
				{live.length > 0 ? (
					<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
						<span className="size-1 animate-pulse rounded-full bg-amber-500" />
						{live.length} active
					</span>
				) : null}
			</div>

			<div className="min-w-0 px-3 pb-3">
				{ready.length === 0 ? (
					<EmptyState
						hint="Generate a photo above and it will appear here."
						message="No generations yet."
					/>
				) : (
					<div className="grid min-w-0 gap-2">
						{ready.slice(0, 24).map((generation) => (
							<PersonGenerationCard
								generation={generation}
								key={generation.id}
							/>
						))}
					</div>
				)}
			</div>
		</section>
	);
}

function PersonGenerationCard({
	generation,
}: {
	generation: PersonGenerationRecord;
}) {
	const url = generation.previewUrl ?? generation.sourceUrl;
	const [copied, setCopied] = useState(false);

	async function handleCopyUrl() {
		try {
			await copyValueToClipboard(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
			toast.success("Image URL copied. Pick a scenario and paste it as input.");
		} catch {
			toast.error("Unable to copy URL.");
		}
	}

	return (
		<article className="grid min-w-0 gap-2 rounded-lg bg-muted/8 p-2.5 dark:bg-muted/5">
			<div className="flex min-w-0 items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[11px]">
						{generation.title || "Generation"}
					</p>
					<p className="line-clamp-2 text-[10px] text-muted-foreground">
						{generation.prompt}
					</p>
					<p className="mt-0.5 text-[10px] text-muted-foreground/80">
						{formatRelativeTime(generation.createdAt)}
					</p>
				</div>
			</div>
			{url ? (
				<a
					className="group relative aspect-[9/16] max-h-56 overflow-hidden rounded-md bg-black/30"
					href={url}
					rel="noopener noreferrer"
					target="_blank"
				>
					<div
						aria-hidden="true"
						className="absolute inset-0 bg-center bg-cover transition group-hover:scale-105"
						style={{ backgroundImage: `url("${url}")` }}
					/>
					<span className="sr-only">Open generation in new tab</span>
				</a>
			) : null}
			<div className="flex flex-wrap items-center gap-1">
				<Button
					className="h-6 px-2 text-[10px]"
					onClick={() => {
						handleCopyUrl().catch(() => undefined);
					}}
					size="sm"
					variant="outline"
				>
					{copied ? (
						<Check className="size-3 text-emerald-500" />
					) : (
						<Copy className="size-3" />
					)}
					Copy URL for scenario
				</Button>
				{url ? (
					<a
						className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
						href={url}
						rel="noreferrer noopener"
						target="_blank"
					>
						Open
						<ExternalLink className="size-2.5" />
					</a>
				) : null}
			</div>
		</article>
	);
}

export default function CommandSidebar({
	className,
	getPersonHref,
	getScenarioHref,
	onCreateScenario,
	onDeleteScenario,
	onEditScenario,
	onPersonRefreshed,
	onPickPerson,
	onPickScenario,
	onSnapshotChange,
	persons,
	scenarioCards,
	selectedPerson,
	selectedPersonId,
	selectedScenarioId,
	snapshot,
	sourceImageTransfer,
}: CommandSidebarProps) {
	// Раньше здесь был локальный useState<AdminSnapshot>(initialSnapshot) +
	// useEffect(setSnapshot(initialSnapshot)). Это давало двойной ререндер на
	// каждое обновление снапшота из родителя (auto-sync, launch run, save shot)
	// — компонент сначала перерисовывался с новым prop, затем повторно после
	// setSnapshot из эффекта, отсюда мерцание. Используем prop как единственный
	// источник правды.
	const [runDrafts, setRunDrafts] = useState<Record<string, RunDraft>>({});
	const [submittingRunId, setSubmittingRunId] = useState<string | null>(null);
	const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
	const [linkedPerson, setLinkedPerson] = useState<LinkedPersonState>(null);
	const [runFilter, setRunFilter] = useState<RunFilter>("all");
	const searchParams = useSearchParams();
	const focusedRunId = searchParams.get("run");
	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";

	const runs = snapshot.runs;
	const scenarios = snapshot.scenarios;
	const workflows = snapshot.workflows;
	const isPersonMode = selectedPerson !== null;
	const selectedScenario = isPersonMode
		? null
		: (scenarios.find((scenario) => scenario.id === selectedScenarioId) ??
			null);
	const selectedScenarioRuns = useMemo(() => {
		if (isPersonMode) {
			return [];
		}
		if (!selectedScenarioId) {
			return runs.slice(0, 12);
		}
		return runs.filter((run) => run.scenarioId === selectedScenarioId);
	}, [isPersonMode, runs, selectedScenarioId]);
	const filteredRuns = useMemo(
		() =>
			selectedScenarioRuns.filter((run) =>
				matchesRunFilter(run.status, runFilter)
			),
		[runFilter, selectedScenarioRuns]
	);
	const recentReferences = useMemo(
		() => getRecentReferenceOptions(runs),
		[runs]
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
		setRunDrafts((current) => {
			let changed = false;
			const nextDrafts: Record<string, RunDraft> = { ...current };
			for (const scenario of scenarios) {
				const existing = nextDrafts[scenario.id];
				if (!existing) {
					nextDrafts[scenario.id] = {
						...createRunDraft(scenario.id),
						inputImageUrl: getLatestScenarioInputImage(runs, scenario.id),
					};
					changed = true;
					continue;
				}
				if (!existing.inputImageUrl) {
					const latest = getLatestScenarioInputImage(runs, scenario.id);
					if (latest) {
						nextDrafts[scenario.id] = { ...existing, inputImageUrl: latest };
						changed = true;
					}
				}
			}
			// Возвращаем тот же ref, если ничего не изменилось — иначе React
			// делает лишний коммит при каждом auto-sync.
			return changed ? nextDrafts : current;
		});
	}, [runs, scenarios]);

	useEffect(() => {
		if (!sourceImageTransfer) {
			return;
		}
		setRunDrafts((current) => {
			const existing =
				current[sourceImageTransfer.scenarioId] ??
				createRunDraft(sourceImageTransfer.scenarioId);
			return {
				...current,
				[sourceImageTransfer.scenarioId]: {
					...existing,
					inputImageUrl: sourceImageTransfer.url,
					inputPersonGenerationId: null,
					inputPersonId: null,
					scenarioId: sourceImageTransfer.scenarioId,
					uploadStorage: null,
				},
			};
		});
	}, [sourceImageTransfer]);

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
			onSnapshotChange({
				...snapshot,
				runs: [result.data, ...snapshot.runs],
			});
			setRunDrafts((current) => ({
				...current,
				[scenario.id]: {
					...createRunDraft(scenario.id),
					inputImageUrl: result.data.inputImageUrl,
					promptOverride: undefined,
					promptSource: undefined,
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
			<header className="flex shrink-0 flex-col border-foreground/6 border-b dark:border-foreground/10">
				<div className="flex min-w-0 items-center gap-1 px-2 py-2">
					<div className="min-w-0 flex-1">
						<SubjectSwitcher
							getPersonHref={getPersonHref}
							getScenarioHref={getScenarioHref}
							onCreateScenario={
								onCreateScenario ? () => onCreateScenario() : undefined
							}
							onDeleteScenario={onDeleteScenario}
							onEditScenario={onEditScenario}
							onPickPerson={onPickPerson}
							onPickScenario={onPickScenario}
							persons={persons}
							scenarios={scenarioCards}
							selectedPerson={selectedPerson}
							selectedPersonId={selectedPersonId}
							selectedScenarioId={selectedScenarioId}
						/>
					</div>
				</div>
			</header>

			<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
				{isPersonMode && selectedPerson ? (
					<>
						<PersonLaunchSection
							onPersonRefreshed={onPersonRefreshed}
							person={selectedPerson}
						/>
						<PersonActivitySection person={selectedPerson} />
					</>
				) : null}
				{!isPersonMode && selectedScenario ? (
					<>
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
							workflow={selectedScenarioWorkflow}
						/>
						<ScenarioActivitySection
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
					</>
				) : null}
				{isPersonMode || selectedScenario ? null : (
					<section className="px-3 py-3">
						<EmptyState
							action={
								onCreateScenario ? (
									<Button onClick={() => onCreateScenario()} size="sm">
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
			</div>
		</aside>
	);
}
