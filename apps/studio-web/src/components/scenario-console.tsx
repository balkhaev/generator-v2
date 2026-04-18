"use client";

import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import {
	type AdminSnapshot,
	deleteStudioShot,
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
import { SectionLabel } from "@generator/ui/components/section-label";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import {
	Bookmark,
	Check,
	ChevronDown,
	Copy,
	ExternalLink,
	Loader2,
	Play,
	Plus,
	RefreshCw,
	RotateCw,
	Sparkles,
	Trash2,
	Upload,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import IconButton from "@/components/icon-button";
import PersonsInputPicker from "@/components/persons-input-picker";
import { getMediaType } from "@/components/preview-surface";

interface ScenarioConsoleProps {
	className?: string;
	onCreateScenario?: () => void;
	onSnapshotChange?: (snapshot: AdminSnapshot) => void;
	selectedScenarioId: string | null;
	snapshot: AdminSnapshot;
}

type ConsoleTab = "launch" | "runs" | "shots";
type RunFilter = "all" | "active" | "succeeded" | "failed";

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

async function findPersonSlugByOperatorRunId(operatorRunId: string) {
	const payload = await requestJson<{ person: { slug: string } }>(
		`${personsApiBaseUrl}/api/persons/lookup/run/${operatorRunId}`,
		{
			cache: "no-store",
		}
	);

	return payload.person.slug;
}

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

function readConsoleTabParam(tab: string | null): ConsoleTab {
	if (tab === "runs" || tab === "shots") {
		return tab;
	}

	return "launch";
}

function buildConsoleHref(
	pathname: string,
	currentSearch: string,
	tab: ConsoleTab
) {
	const params = new URLSearchParams(currentSearch);
	params.set("tab", tab);
	return `${pathname}?${params.toString()}` as Route;
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
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
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

function ScenarioInfoHeader({ scenario }: { scenario: ScenarioRecord | null }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const params = Object.entries(scenario?.params ?? {});

	if (!scenario) {
		return null;
	}

	return (
		<div className="border-foreground/6 border-b dark:border-foreground/10">
			<button
				className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition hover:bg-muted/10"
				onClick={() => setIsExpanded((current) => !current)}
				type="button"
			>
				<div className="min-w-0 flex-1">
					<p className="truncate text-xs">{scenario.name}</p>
					<p className="truncate text-[11px] text-muted-foreground">
						{scenario.workflowKey} · {formatScenarioDuration(scenario.params)}
					</p>
				</div>
				<ChevronDown
					aria-hidden="true"
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						isExpanded && "rotate-180"
					)}
				/>
			</button>
			{isExpanded ? (
				<div className="grid gap-2 px-3 pb-3">
					<p className="text-muted-foreground text-xs leading-relaxed">
						{scenario.prompt}
					</p>
					{params.length > 0 ? (
						<div className="grid grid-cols-2 gap-1.5">
							{params.map(([key, value]) => (
								<div
									className="rounded-lg bg-muted/10 px-2 py-1.5 dark:bg-muted/5"
									key={key}
								>
									<p className="text-[11px] text-muted-foreground">{key}</p>
									<p className="text-xs">{String(value)}</p>
								</div>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

const runFilterOptions: { id: RunFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "active", label: "Active" },
	{ id: "succeeded", label: "Done" },
	{ id: "failed", label: "Failed" },
];

function matchesRunFilter(
	status: ScenarioRunRecord["status"],
	filter: RunFilter
) {
	if (filter === "all") {
		return true;
	}

	if (filter === "active") {
		return status === "queued" || status === "running";
	}

	return status === filter;
}

function ScenarioRunCard({
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
				"grid gap-2 rounded-lg bg-muted/8 p-3 transition dark:bg-muted/5",
				isFocused && "ring-1 ring-foreground/30"
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-xs">{run.scenarioName}</p>
					<p className="truncate text-[11px] text-muted-foreground">
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
							<Check className="size-3.5 text-emerald-500" />
						) : (
							<Copy className="size-3.5" />
						)}
					</IconButton>
				</div>
			</div>

			{outputThumbnails.length > 0 ? (
				<div className="grid grid-cols-3 gap-1">
					{outputThumbnails.map((url, index) => (
						<a
							aria-label={`Open output ${index + 1}`}
							className="group relative aspect-video overflow-hidden rounded-md bg-black/30"
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

			<div className="grid grid-cols-2 gap-1.5">
				<div className="rounded-lg bg-muted/10 px-2.5 py-1.5 dark:bg-muted/5">
					<p className="text-[10px] text-muted-foreground">Input</p>
					<p className="truncate text-[11px]">{run.inputLabel}</p>
				</div>
				<div className="rounded-lg bg-muted/10 px-2.5 py-1.5 dark:bg-muted/5">
					<p className="text-[10px] text-muted-foreground">Outputs</p>
					<p className="text-[11px] tabular-nums">{run.artifactUrls.length}</p>
				</div>
			</div>

			{run.errorSummary ? (
				<p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-rose-700 text-xs dark:text-rose-300">
					{run.errorSummary}
				</p>
			) : null}

			<div className="flex flex-wrap items-center gap-1.5">
				{hasLinkedPerson ? (
					<a
						className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
						href={`${personsUrl}/person/${linkedPerson.personSlug}`}
						rel="noreferrer noopener"
					>
						Person
						<ExternalLink className="size-3" />
					</a>
				) : null}
				<a
					className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
					href={run.inputImageUrl}
					rel="noreferrer noopener"
					target="_blank"
				>
					Source
					<ExternalLink className="size-3" />
				</a>
				{run.artifactUrls.slice(0, 2).map((artifactUrl, index) => (
					<a
						className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
						href={artifactUrl}
						key={artifactUrl}
						rel="noreferrer noopener"
						target="_blank"
					>
						Output {index + 1}
						<ExternalLink className="size-3" />
					</a>
				))}
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

export default function ScenarioConsole({
	className,
	onCreateScenario,
	onSnapshotChange,
	selectedScenarioId,
	snapshot: initialSnapshot,
}: ScenarioConsoleProps) {
	const [error, setError] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [runDrafts, setRunDrafts] = useState<Record<string, RunDraft>>({});
	const [snapshot, setSnapshot] = useState<AdminSnapshot>(initialSnapshot);
	const [linkedPerson, setLinkedPerson] = useState<LinkedPersonState>(null);
	const [submittingRunId, setSubmittingRunId] = useState<string | null>(null);
	const [syncingRunId, setSyncingRunId] = useState<string | null>(null);
	const [runFilter, setRunFilter] = useState<RunFilter>("all");
	const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
	const [deletingShotId, setDeletingShotId] = useState<string | null>(null);
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const currentSearch = searchParams.toString();
	const activeTab = readConsoleTabParam(searchParams.get("tab"));
	const focusedRunId = searchParams.get("run");
	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";

	const runs = snapshot.runs;
	const scenarios = snapshot.scenarios;
	const workflows = snapshot.workflows;
	const selectedScenario =
		scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
	const selectedScenarioRuns = useMemo(() => {
		if (!selectedScenarioId) {
			return runs.slice(0, 8);
		}

		return runs.filter((run) => run.scenarioId === selectedScenarioId);
	}, [runs, selectedScenarioId]);
	const filteredScenarioRuns = useMemo(
		() =>
			selectedScenarioRuns.filter((run) =>
				matchesRunFilter(run.status, runFilter)
			),
		[runFilter, selectedScenarioRuns]
	);
	const recentReferences = useMemo(
		() => getRecentReferenceOptions(runs, selectedScenarioId),
		[runs, selectedScenarioId]
	);
	const selectedScenarioShots = useMemo(() => {
		if (!selectedScenarioId) {
			return snapshot.shots ?? [];
		}
		return (snapshot.shots ?? []).filter(
			(shot) => shot.scenarioId === selectedScenarioId
		);
	}, [snapshot.shots, selectedScenarioId]);
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
		const initialWorkflow = initialSnapshot.workflows[0] ?? null;
		setError(
			initialWorkflow
				? null
				: "No workflows are available for the scenario console yet."
		);
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
		function handleKeydown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				target?.isContentEditable === true;

			if (isEditableTarget || event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}

			let nextTab: ConsoleTab | null = null;

			if (event.key === "l" || event.key === "L") {
				nextTab = "launch";
			} else if (event.key === "r" || event.key === "R") {
				nextTab = "runs";
			} else if (event.key === "c" || event.key === "C") {
				event.preventDefault();
				onCreateScenario?.();
				return;
			}

			if (!nextTab) {
				return;
			}

			event.preventDefault();
			router.replace(buildConsoleHref(pathname, currentSearch, nextTab), {
				scroll: false,
			});
		}

		window.addEventListener("keydown", handleKeydown);
		return () => {
			window.removeEventListener("keydown", handleKeydown);
		};
	}, [currentSearch, onCreateScenario, pathname, router]);

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

				setLinkedPerson({
					personSlug,
					runId: targetRunId,
				});
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

	async function loadSnapshot({ silent = false }: { silent?: boolean } = {}) {
		if (!silent) {
			setIsRefreshing(true);
		}

		try {
			const nextSnapshot = await getStudioSnapshot();
			setSnapshot(nextSnapshot);
			onSnapshotChange?.(nextSnapshot);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: "Unable to load the scenario console."
			);
		} finally {
			setIsRefreshing(false);
		}
	}

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
				const nextSnapshot = {
					...current,
					runs: [result.data, ...current.runs],
				};
				onSnapshotChange?.(nextSnapshot);
				return nextSnapshot;
			});
			setRunDrafts((current) => ({
				...current,
				[scenario.id]: {
					...createRunDraft(scenario.id),
					inputImageUrl: result.data.inputImageUrl,
				},
			}));
			router.replace(buildConsoleHref(pathname, currentSearch, "runs"), {
				scroll: false,
			});
			toast.success("Run queued.");
		} catch (runError) {
			toast.error(
				runError instanceof Error ? runError.message : "Unable to launch run."
			);
		} finally {
			setSubmittingRunId(null);
		}
	}

	async function handleSyncRun(runId: string) {
		setSyncingRunId(runId);

		try {
			const result = await syncStudioRun(runId);

			setSnapshot((current) => {
				const nextSnapshot = {
					...current,
					runs: current.runs.map((run) =>
						run.id === runId ? result.data : run
					),
				};
				onSnapshotChange?.(nextSnapshot);
				return nextSnapshot;
			});
			toast.success("Run status refreshed.");
		} catch (syncError) {
			toast.error(
				syncError instanceof Error
					? syncError.message
					: "Unable to sync run status."
			);
		} finally {
			setSyncingRunId(null);
		}
	}

	async function handleDeleteShot(shotId: string) {
		setDeletingShotId(shotId);
		try {
			await deleteStudioShot(shotId);
			setSnapshot((current) => {
				const nextSnapshot = {
					...current,
					shots: current.shots.filter((shot) => shot.id !== shotId),
				};
				onSnapshotChange?.(nextSnapshot);
				return nextSnapshot;
			});
			toast.success("Shot removed.");
		} catch (shotError) {
			toast.error(
				shotError instanceof Error
					? shotError.message
					: "Unable to delete shot."
			);
		} finally {
			setDeletingShotId(null);
		}
	}

	function renderLaunchTab() {
		if (!selectedScenario) {
			return (
				<EmptyState
					action={
						onCreateScenario ? (
							<Button onClick={onCreateScenario} size="sm">
								<Plus className="size-3.5" />
								Compose scenario
							</Button>
						) : null
					}
					hint="The launch panel stays pinned to the active scenario."
					message="Create or select a scenario to launch."
				/>
			);
		}

		const storageLabel = getStorageLabel(
			selectedRunDraft?.uploadStorage ?? null
		);
		const requiresInputImage = Boolean(
			selectedScenarioWorkflow?.requiresInputImage
		);
		const isReadyToLaunch =
			!requiresInputImage || Boolean(selectedRunDraft?.inputImageUrl?.trim());

		const pickerReferences = recentReferences.map((run) => ({
			id: run.id,
			label: run.inputLabel,
			url: run.inputImageUrl,
		}));

		return (
			<div className="grid gap-3">
				<div className="grid gap-2 rounded-lg bg-muted/10 px-3 py-2.5 dark:bg-muted/5">
					<SectionLabel>Prompt</SectionLabel>
					<p className="line-clamp-3 text-foreground/90 text-xs leading-relaxed">
						{selectedScenario.prompt || (
							<span className="text-muted-foreground italic">
								No prompt set. Switch to Compose to add one.
							</span>
						)}
					</p>
					<div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
						<span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
							{selectedScenario.workflowKey}
						</span>
						<span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
							{formatScenarioDuration(selectedScenario.params)}
						</span>
						<span className="rounded-full bg-foreground/[0.04] px-2 py-0.5">
							{selectedScenarioRuns.length} runs
						</span>
						{activeRunCount > 0 ? (
							<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
								<span className="size-1 animate-pulse rounded-full bg-amber-500" />
								{activeRunCount} active
							</span>
						) : null}
					</div>
				</div>

				{requiresInputImage ? (
					<div className="grid gap-2">
						<SectionLabel>Input</SectionLabel>
						<PersonsInputPicker
							currentUrl={selectedRunDraft?.inputImageUrl ?? ""}
							onPick={(pick) => {
								setRunDrafts((current) => ({
									...current,
									[selectedScenario.id]: {
										...(current[selectedScenario.id] ??
											createRunDraft(selectedScenario.id)),
										inputImageUrl: pick.url,
										inputPersonGenerationId: pick.personGenerationId ?? null,
										inputPersonId: pick.personId ?? null,
										scenarioId: selectedScenario.id,
										uploadStorage: pick.storage ?? null,
									},
								}));
							}}
							recentReferences={pickerReferences}
							storageLabel={storageLabel}
						/>
					</div>
				) : null}

				<Button
					disabled={!isReadyToLaunch || submittingRunId === selectedScenario.id}
					onClick={() => handleLaunchRun(selectedScenario)}
					size="sm"
				>
					{submittingRunId === selectedScenario.id ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Play className="size-3.5" />
					)}
					{isReadyToLaunch ? "Launch run" : "Add an input image to launch"}
				</Button>
			</div>
		);
	}

	function renderRunsTab() {
		if (selectedScenarioRuns.length === 0) {
			return (
				<EmptyState
					action={
						<Button
							onClick={() =>
								router.replace(
									buildConsoleHref(pathname, currentSearch, "launch"),
									{ scroll: false }
								)
							}
							size="sm"
						>
							<Play className="size-3.5" />
							Launch a run
						</Button>
					}
					hint="Launch a scenario from the Launch tab to populate this list."
					message="No runs yet."
				/>
			);
		}

		return (
			<div className="grid gap-2">
				<div className="flex flex-wrap items-center gap-1">
					{runFilterOptions.map((option) => {
						const count =
							option.id === "all"
								? selectedScenarioRuns.length
								: selectedScenarioRuns.filter((run) =>
										matchesRunFilter(run.status, option.id)
									).length;
						const isActive = runFilter === option.id;
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
								onClick={() => setRunFilter(option.id)}
								type="button"
							>
								{option.label}
								<span className="tabular-nums">{count}</span>
							</button>
						);
					})}
				</div>

				{filteredScenarioRuns.length === 0 ? (
					<EmptyState
						hint="Switch the filter to see other runs."
						message={`No ${runFilter} runs.`}
					/>
				) : (
					filteredScenarioRuns.map((run) => (
						<ScenarioRunCard
							isCopied={copiedRunId === run.id}
							isFocused={
								focusedRunId === run.id || focusedRunId === run.providerJobId
							}
							key={run.id}
							linkedPerson={linkedPerson}
							onCopyRunId={handleCopyRunId}
							onSyncRun={handleSyncRun}
							personsUrl={personsUrl}
							run={run}
							syncingRunId={syncingRunId}
						/>
					))
				)}
			</div>
		);
	}

	function renderShotsTab() {
		if (selectedScenarioShots.length === 0) {
			return (
				<EmptyState
					hint="Use Save shot from preview to bookmark generations into this scenario."
					message="No saved shots yet."
				/>
			);
		}

		return (
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
				{selectedScenarioShots.map((shot) => {
					const isImage = shot.artifactKind === "image";
					return (
						<article
							className="group relative overflow-hidden rounded-xl border border-foreground/8 bg-muted/5"
							key={shot.id}
						>
							{isImage ? (
								<div
									aria-hidden="true"
									className="aspect-square bg-center bg-cover"
									style={{ backgroundImage: `url("${shot.artifactUrl}")` }}
								/>
							) : (
								<video
									className="aspect-square w-full object-cover"
									controls={false}
									muted
									playsInline
									preload="metadata"
									src={shot.artifactUrl}
								/>
							)}
							<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pt-6 pb-2">
								<div className="min-w-0 text-white">
									<p className="truncate text-[11px]">{shot.scenarioName}</p>
									<p className="truncate text-[10px] text-white/70">
										{formatRelativeTime(shot.createdAt)}
									</p>
								</div>
								<div className="flex items-center gap-1">
									<a
										aria-label="Open shot"
										className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
										href={shot.artifactUrl}
										rel="noreferrer"
										target="_blank"
									>
										<ExternalLink className="size-3" />
									</a>
									<button
										aria-label="Delete shot"
										className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-rose-500/60 disabled:opacity-50"
										disabled={deletingShotId === shot.id}
										onClick={() => {
											handleDeleteShot(shot.id).catch(() => undefined);
										}}
										type="button"
									>
										{deletingShotId === shot.id ? (
											<Loader2 className="size-3 animate-spin" />
										) : (
											<Trash2 className="size-3" />
										)}
									</button>
								</div>
							</div>
						</article>
					);
				})}
			</div>
		);
	}

	let content: ReactNode;
	if (activeTab === "launch") {
		content = renderLaunchTab();
	} else if (activeTab === "runs") {
		content = renderRunsTab();
	} else {
		content = renderShotsTab();
	}

	const tabs: {
		badge?: number;
		dot?: boolean;
		icon: typeof Sparkles;
		id: ConsoleTab;
		label: string;
		shortcut: string;
	}[] = [
		{ icon: Sparkles, id: "launch", label: "Launch", shortcut: "L" },
		{
			badge: selectedScenarioRuns.length,
			dot: activeRunCount > 0,
			icon: Upload,
			id: "runs",
			label: "Runs",
			shortcut: "R",
		},
		{
			badge: selectedScenarioShots.length,
			icon: Bookmark,
			id: "shots",
			label: "Shots",
			shortcut: "S",
		},
	];

	return (
		<section
			className={cn("studio-surface flex min-h-0 min-w-0 flex-col", className)}
		>
			<div className="flex items-center justify-between gap-2 px-3 py-2.5">
				<div className="flex min-w-0 items-center gap-2">
					<SectionLabel>Dock</SectionLabel>
					{activeRunCount > 0 ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
							<span className="size-1 animate-pulse rounded-full bg-amber-500" />
							auto-syncing
						</span>
					) : null}
				</div>

				<div className="flex items-center gap-1">
					{onCreateScenario ? (
						<Button onClick={onCreateScenario} size="xs" variant="outline">
							<Plus className="size-3" />
							Compose
						</Button>
					) : null}
					<IconButton
						hint="Refresh snapshot"
						label="Refresh snapshot"
						onClick={() => {
							loadSnapshot({ silent: false }).catch(() => undefined);
						}}
					>
						{isRefreshing ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<RefreshCw className="size-3.5" />
						)}
					</IconButton>
				</div>
			</div>

			<ScenarioInfoHeader scenario={selectedScenario} />

			<nav
				aria-label="Console tabs"
				className="flex items-center gap-0.5 border-foreground/6 border-b px-3 py-1.5 dark:border-foreground/10"
			>
				{tabs.map((tab) => {
					const Icon = tab.icon;
					const isActive = tab.id === activeTab;

					return (
						<Link
							aria-current={isActive ? "true" : undefined}
							className={cn(
								"flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition",
								isActive
									? "bg-foreground text-background"
									: "text-muted-foreground hover:bg-muted/15 hover:text-foreground"
							)}
							href={buildConsoleHref(pathname, currentSearch, tab.id)}
							key={tab.id}
							scroll={false}
							title={`${tab.label} (${tab.shortcut})`}
						>
							<Icon className="size-3.5" />
							{tab.label}
							{typeof tab.badge === "number" && tab.badge > 0 ? (
								<span
									className={cn(
										"ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 py-0 text-[9px] tabular-nums",
										isActive
											? "bg-background/15 text-background"
											: "bg-foreground/10 text-foreground"
									)}
								>
									{tab.badge}
								</span>
							) : null}
							{tab.dot && !isActive ? (
								<span
									aria-hidden="true"
									className="ml-0.5 size-1.5 animate-pulse rounded-full bg-amber-500"
								/>
							) : null}
						</Link>
					);
				})}
			</nav>

			<div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
				{content}
			</div>

			{error ? (
				<div className="rounded-b-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
					{error}
				</div>
			) : null}
		</section>
	);
}
