"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import {
	type AdminSnapshot,
	createStudioScenario,
	getStudioSnapshot,
	type LaunchRunInput,
	launchStudioRun,
	type ScenarioFormState,
	type ScenarioRecord,
	type ScenarioRunRecord,
	syncStudioRun,
	type UploadedInputAsset,
	uploadStudioInputImage,
} from "@generator/studio-client/client";
import {
	buildCreateScenarioInput,
	createScenarioFormState,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
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
	ChevronDown,
	Copy,
	ExternalLink,
	ImageUp,
	Loader2,
	Package2,
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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import IconButton from "@/components/icon-button";
import { getMediaType } from "@/components/preview-surface";

interface ScenarioConsoleProps {
	className?: string;
	onScenarioSelect?: (scenarioId: string) => void;
	onSnapshotChange?: (snapshot: AdminSnapshot) => void;
	selectedScenarioId: string | null;
	snapshot: AdminSnapshot;
}

type ConsoleTab = "compose" | "launch" | "runs";
type RunFilter = "all" | "active" | "succeeded" | "failed";

type RunDraft = LaunchRunInput & {
	uploadStorage?: UploadedInputAsset["storage"] | null;
};

interface PresetReadiness {
	assetCount: number;
	description: string;
	id: string;
	matchedAssets: number;
	missingAssets: number;
	name: string;
	sourceUrl: string;
	status: "missing" | "partial" | "ready";
	workflowKeys: readonly string[];
}

type LinkedPersonState = {
	personSlug: string;
	runId: string;
} | null;

const personsApiBaseUrl = normalizeBaseUrl(
	env.NEXT_PUBLIC_PERSONS_API_URL ?? "http://localhost:3003"
);

const studioApiBaseUrl = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

async function fetchStudioLoras(
	baseModel?: string
): Promise<LoraRegistryEntry[]> {
	const params = new URLSearchParams();
	if (baseModel) {
		params.set("baseModel", baseModel);
	}
	const query = params.toString();
	try {
		const payload = await requestJson<{ loras: LoraRegistryEntry[] }>(
			`${studioApiBaseUrl}/api/loras${query ? `?${query}` : ""}`,
			{ cache: "no-store", credentials: "include" }
		);
		return payload.loras;
	} catch {
		return [];
	}
}

async function findPersonSlugByOperatorRunId(operatorRunId: string) {
	const payload = await requestJson<{ person: { slug: string } }>(
		`${personsApiBaseUrl}/api/persons/lookup/run/${operatorRunId}`,
		{
			cache: "no-store",
		}
	);

	return payload.person.slug;
}

const textareaClassName =
	"min-h-20 w-full rounded-lg border border-input bg-background/45 px-2.5 py-2 text-xs leading-5 outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";
const selectClassName =
	"h-8 w-full rounded-lg border border-input bg-background/45 px-2.5 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

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

const presetStatusTone: Record<PresetReadiness["status"], string> = {
	missing: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	partial: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};
const adminWebUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
const trailingSlashesPattern = /\/+$/u;
const adminLorasHref = `${adminWebUrl.replace(trailingSlashesPattern, "")}/loras`;

function readConsoleTabParam(tab: string | null): ConsoleTab {
	if (tab === "compose" || tab === "runs") {
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
	const frameRate =
		typeof params?.frameRate === "number"
			? params.frameRate
			: Number(params?.frameRate);
	const numFrames =
		typeof params?.numFrames === "number"
			? params.numFrames
			: Number(params?.numFrames);

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

function buildPresetReadiness(snapshot: AdminSnapshot): PresetReadiness[] {
	return snapshot.presets.map((preset) => {
		const matchedAssets = preset.assets.filter((asset) => {
			return snapshot.releases.some((release) => {
				if (release.group !== asset.group) {
					return false;
				}

				return release.items.some((item) => item.fileName === asset.fileName);
			});
		}).length;
		const assetCount = preset.assets.length;
		const missingAssets = Math.max(assetCount - matchedAssets, 0);
		let status: PresetReadiness["status"] = "missing";

		if (missingAssets === 0) {
			status = "ready";
		} else if (matchedAssets > 0) {
			status = "partial";
		}

		return {
			assetCount,
			description: preset.description,
			id: preset.id,
			matchedAssets,
			missingAssets,
			name: preset.name,
			sourceUrl: preset.sourceUrl,
			status,
			workflowKeys: preset.workflowKeys,
		};
	});
}

const previewableUrlPattern = /^(https?:\/\/.{3,}|data:\w+\/)/;

function RecentInputPicker({
	activeUrl,
	onSelect,
	references,
}: {
	activeUrl: string;
	onSelect: (url: string) => void;
	references: ScenarioRunRecord[];
}) {
	return (
		<div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto py-0.5">
			{references.map((run) => {
				const isActive = activeUrl === run.inputImageUrl;

				return (
					<Tooltip key={run.id}>
						<TooltipTrigger
							render={
								<button
									aria-label={run.inputLabel}
									className={cn(
										"group relative aspect-square overflow-hidden rounded-lg transition",
										isActive
											? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
											: "opacity-70 hover:opacity-100"
									)}
									onClick={() => onSelect(run.inputImageUrl)}
									type="button"
								/>
							}
						>
							<div
								aria-hidden="true"
								className="absolute inset-0 bg-center bg-cover"
								style={{ backgroundImage: `url("${run.inputImageUrl}")` }}
							/>
							<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pt-3 pb-1">
								<p className="truncate text-center text-[10px] text-white leading-tight">
									{run.inputLabel}
								</p>
							</div>
						</TooltipTrigger>
						<TooltipContent>{run.inputLabel}</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
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
	onScenarioSelect,
	onSnapshotChange,
	selectedScenarioId,
	snapshot: initialSnapshot,
}: ScenarioConsoleProps) {
	const [error, setError] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isSavingScenario, setIsSavingScenario] = useState(false);
	const [isUploadingImage, setIsUploadingImage] = useState(false);
	const [runDrafts, setRunDrafts] = useState<Record<string, RunDraft>>({});
	const [scenarioForm, setScenarioForm] = useState<ScenarioFormState | null>(
		null
	);
	const [snapshot, setSnapshot] = useState<AdminSnapshot>(initialSnapshot);
	const [availableLoras, setAvailableLoras] = useState<LoraRegistryEntry[]>([]);
	const [linkedPerson, setLinkedPerson] = useState<LinkedPersonState>(null);
	const [submittingRunId, setSubmittingRunId] = useState<string | null>(null);
	const [syncingRunId, setSyncingRunId] = useState<string | null>(null);
	const [uploadProgressPct, setUploadProgressPct] = useState(0);
	const [runFilter, setRunFilter] = useState<RunFilter>("all");
	const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
	const fileInputId = useId();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
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
	const selectedRunDraft = selectedScenario
		? (runDrafts[selectedScenario.id] ?? createRunDraft(selectedScenario.id))
		: null;

	const selectedWorkflow = useMemo(() => {
		if (!scenarioForm) {
			return workflows[0] ?? null;
		}

		return (
			workflows.find((workflow) => workflow.key === scenarioForm.workflowKey) ??
			workflows[0] ??
			null
		);
	}, [scenarioForm, workflows]);
	const presetReadiness = useMemo(
		() => buildPresetReadiness(snapshot),
		[snapshot]
	);
	const suggestedPresets = useMemo(() => {
		if (!selectedWorkflow) {
			return presetReadiness;
		}

		return presetReadiness.filter((preset) =>
			preset.workflowKeys.includes(selectedWorkflow.key)
		);
	}, [presetReadiness, selectedWorkflow]);

	const activeRunCount = selectedScenarioRuns.filter(
		(run) => run.status === "queued" || run.status === "running"
	).length;

	useEffect(() => {
		let cancelled = false;
		fetchStudioLoras(selectedWorkflow?.baseModel).then((items) => {
			if (!cancelled) {
				setAvailableLoras(items);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [selectedWorkflow?.baseModel]);

	useEffect(() => {
		setSnapshot(initialSnapshot);
		const initialWorkflow = initialSnapshot.workflows[0] ?? null;
		setError(
			initialWorkflow
				? null
				: "No workflows are available for the scenario console yet."
		);
		setScenarioForm((current) => {
			if (!initialWorkflow) {
				return null;
			}

			if (
				current &&
				initialSnapshot.workflows.some(
					(workflow) => workflow.key === current.workflowKey
				)
			) {
				return current;
			}

			return createScenarioFormState(initialWorkflow);
		});
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
			} else if (event.key === "c" || event.key === "C") {
				nextTab = "compose";
			} else if (event.key === "r" || event.key === "R") {
				nextTab = "runs";
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
	}, [currentSearch, pathname, router]);

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

	async function handleCreateScenario(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!(scenarioForm && selectedWorkflow)) {
			toast.error("Scenario form is unavailable.");
			return;
		}

		if (!(scenarioForm.name.trim() && scenarioForm.prompt.trim())) {
			toast.error("Scenario name and prompt are required.");
			return;
		}

		setIsSavingScenario(true);

		try {
			const result = await createStudioScenario(
				buildCreateScenarioInput(selectedWorkflow, {
					...scenarioForm,
					name: scenarioForm.name.trim(),
					prompt: scenarioForm.prompt.trim(),
				})
			);

			setSnapshot((current) => {
				const nextSnapshot = {
					...current,
					scenarios: [result.data, ...current.scenarios],
				};
				onSnapshotChange?.(nextSnapshot);
				return nextSnapshot;
			});
			setRunDrafts((current) => ({
				...current,
				[result.data.id]: createRunDraft(result.data.id),
			}));
			onScenarioSelect?.(result.data.id);
			setScenarioForm(createScenarioFormState(selectedWorkflow));
			router.replace(buildConsoleHref(pathname, currentSearch, "launch"), {
				scroll: false,
			});
			toast.success("Scenario saved.");
		} catch (createError) {
			toast.error(
				createError instanceof Error
					? createError.message
					: "Unable to save scenario."
			);
		} finally {
			setIsSavingScenario(false);
		}
	}

	async function handleLaunchRun(scenario: ScenarioRecord) {
		const draft = runDrafts[scenario.id] ?? createRunDraft(scenario.id);

		if (!draft.inputImageUrl.trim()) {
			toast.error("Upload an image or paste a URL first.");
			return;
		}

		setSubmittingRunId(scenario.id);

		try {
			const result = await launchStudioRun({
				inputImageUrl: draft.inputImageUrl.trim(),
				scenarioId: scenario.id,
			});

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

	async function handleUploadFile(file: File) {
		if (!selectedScenario) {
			toast.error("Select a scenario before uploading an image.");
			return;
		}

		setIsUploadingImage(true);
		setUploadProgressPct(0);

		try {
			const uploaded = await uploadStudioInputImage({
				file,
				onProgress: setUploadProgressPct,
			});

			setRunDrafts((current) => ({
				...current,
				[selectedScenario.id]: {
					...(current[selectedScenario.id] ??
						createRunDraft(selectedScenario.id)),
					inputImageUrl: uploaded.url,
					scenarioId: selectedScenario.id,
					uploadStorage: uploaded.storage,
				},
			}));
			toast.success("Input image uploaded.");
		} catch (uploadError) {
			toast.error(
				uploadError instanceof Error
					? uploadError.message
					: "Unable to upload image."
			);
		} finally {
			setIsUploadingImage(false);
		}
	}

	function renderComposeTab() {
		if (!(scenarioForm && selectedWorkflow)) {
			return (
				<div className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
					{error ?? "Scenario form is unavailable."}
				</div>
			);
		}

		return (
			<form className="grid gap-3" onSubmit={handleCreateScenario}>
				{suggestedPresets.length > 0 ? (
					<div className="grid gap-2">
						<div className="flex items-center justify-between gap-2">
							<SectionLabel>Presets</SectionLabel>
							<a
								className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"
								href={adminWebUrl}
								rel="noreferrer noopener"
								target="_blank"
							>
								Admin
								<ExternalLink className="size-3" />
							</a>
						</div>
						<div className="grid gap-1.5">
							{suggestedPresets.slice(0, 3).map((preset) => {
								const linkedWorkflow = workflows.find((workflow) =>
									preset.workflowKeys.includes(workflow.key)
								);

								return (
									<div
										className="grid gap-1.5 rounded-lg bg-muted/8 px-3 py-2.5 dark:bg-muted/5"
										key={preset.id}
									>
										<div className="flex items-start justify-between gap-2">
											<p className="min-w-0 truncate text-xs">{preset.name}</p>
											<span
												className={cn(
													"shrink-0 rounded-full px-2 py-0.5 text-[11px]",
													presetStatusTone[preset.status]
												)}
											>
												{preset.matchedAssets}/{preset.assetCount}
											</span>
										</div>
										<div className="flex flex-wrap items-center gap-1.5">
											{linkedWorkflow ? (
												<button
													className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] transition hover:bg-foreground/10"
													onClick={() =>
														setScenarioForm(
															createScenarioFormState(linkedWorkflow)
														)
													}
													type="button"
												>
													<Package2 className="size-3" />
													Use
												</button>
											) : null}
											<a
												className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
												href={preset.sourceUrl}
												rel="noreferrer noopener"
												target="_blank"
											>
												<ExternalLink className="size-3" />
												Source
											</a>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				) : null}

				<div className="grid gap-1.5">
					<SectionLabel>Workflow</SectionLabel>
					<div className="grid gap-1">
						{workflows.map((workflow) => {
							const isActive = workflow.key === scenarioForm.workflowKey;

							return (
								<button
									aria-pressed={isActive}
									className={cn(
										"grid gap-1 rounded-lg px-3 py-2.5 text-left transition",
										isActive
											? "bg-foreground text-background"
											: "bg-muted/8 hover:bg-muted/15 dark:bg-muted/5 dark:hover:bg-muted/10"
									)}
									key={workflow.key}
									onClick={() =>
										setScenarioForm(createScenarioFormState(workflow))
									}
									type="button"
								>
									<div className="flex items-center justify-between gap-2">
										<p className="text-xs">{workflow.name}</p>
										<Sparkles className="size-3.5" />
									</div>
									<p
										className={cn(
											"line-clamp-1 text-[11px]",
											isActive ? "text-background/65" : "text-muted-foreground"
										)}
									>
										{workflow.summary}
									</p>
								</button>
							);
						})}
					</div>
				</div>

				<div className="grid gap-2">
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="scenario-name">
							Name
						</Label>
						<Input
							id="scenario-name"
							onChange={(event) => {
								const value = event.target.value;

								setScenarioForm((current) =>
									current ? { ...current, name: value } : current
								);
							}}
							placeholder="Hero close-up push"
							value={scenarioForm.name}
						/>
					</div>

					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="workflow-key">
							Key
						</Label>
						<select
							className={selectClassName}
							id="workflow-key"
							onChange={(event) => {
								const workflow = workflows.find(
									(item) => item.key === event.target.value
								);

								if (!workflow) {
									return;
								}

								setScenarioForm(createScenarioFormState(workflow));
							}}
							value={scenarioForm.workflowKey}
						>
							{workflows.map((workflow) => (
								<option key={workflow.key} value={workflow.key}>
									{workflow.key}
								</option>
							))}
						</select>
					</div>
				</div>

				<div className="grid gap-1.5">
					<Label className="text-xs" htmlFor="scenario-prompt">
						Prompt
					</Label>
					<textarea
						className={textareaClassName}
						id="scenario-prompt"
						onChange={(event) => {
							const value = event.target.value;

							setScenarioForm((current) =>
								current ? { ...current, prompt: value } : current
							);
						}}
						placeholder={selectedWorkflow.promptHint}
						value={scenarioForm.prompt}
					/>
				</div>

				{selectedWorkflow.parameters.length > 0 ? (
					<div className="grid gap-2 sm:grid-cols-2">
						{selectedWorkflow.parameters.map((parameter) => {
							const currentValue = scenarioForm.params[parameter.key] ?? "";
							const handleChange = (value: string) => {
								setScenarioForm((current) =>
									current
										? {
												...current,
												params: {
													...current.params,
													[parameter.key]: value,
												},
											}
										: current
								);
							};
							if (parameter.kind === "lora-url") {
								const matchedEntry = availableLoras.find(
									(entry) => entry.s3Url === currentValue
								);
								return (
									<div className="grid gap-1" key={parameter.key}>
										<Label className="text-xs" htmlFor={parameter.key}>
											{parameter.label}
										</Label>
										<select
											className={selectClassName}
											id={parameter.key}
											onChange={(event) => handleChange(event.target.value)}
											value={matchedEntry ? matchedEntry.s3Url : currentValue}
										>
											<option value="">None</option>
											{availableLoras.map((entry) => (
												<option key={entry.id} value={entry.s3Url}>
													{entry.name}
												</option>
											))}
										</select>
										<p className="line-clamp-1 text-[11px] text-muted-foreground">
											{parameter.helperText} · Managed in{" "}
											<a
												className="underline"
												href={adminLorasHref}
												rel="noreferrer noopener"
												target="_blank"
											>
												admin · LoRAs
											</a>
										</p>
									</div>
								);
							}
							return (
								<div className="grid gap-1" key={parameter.key}>
									<Label className="text-xs" htmlFor={parameter.key}>
										{parameter.label}
									</Label>
									<Input
										id={parameter.key}
										onChange={(event) => handleChange(event.target.value)}
										placeholder={parameter.defaultValue || parameter.label}
										value={currentValue}
									/>
									<p className="line-clamp-1 text-[11px] text-muted-foreground">
										{parameter.helperText}
									</p>
								</div>
							);
						})}
					</div>
				) : null}

				<Button disabled={isSavingScenario} size="sm" type="submit">
					{isSavingScenario ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Plus className="size-3.5" />
					)}
					Save scenario
				</Button>
			</form>
		);
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: launch tab layout
	function renderLaunchTab() {
		if (!selectedScenario) {
			return (
				<EmptyState
					action={
						<Button
							onClick={() =>
								router.replace(
									buildConsoleHref(pathname, currentSearch, "compose"),
									{ scroll: false }
								)
							}
							size="sm"
						>
							<Plus className="size-3.5" />
							Compose scenario
						</Button>
					}
					hint="The launch panel stays pinned to the active scenario."
					message="Create or select a scenario to launch."
				/>
			);
		}

		const storageLabel = getStorageLabel(
			selectedRunDraft?.uploadStorage ?? null
		);
		const hasValidPreview = previewableUrlPattern.test(
			selectedRunDraft?.inputImageUrl ?? ""
		);
		const isReadyToLaunch =
			Boolean(selectedRunDraft?.inputImageUrl?.trim()) && !isUploadingImage;

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

				<div className="grid gap-2">
					<div className="flex items-center justify-between gap-2">
						<SectionLabel>Input image</SectionLabel>
						{storageLabel ? (
							<span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
								{storageLabel}
							</span>
						) : null}
					</div>
					<input
						accept="image/*"
						className="sr-only"
						id={fileInputId}
						onChange={(event) => {
							const file = event.target.files?.[0];

							if (file) {
								handleUploadFile(file).catch(() => undefined);
							}

							event.target.value = "";
						}}
						ref={fileInputRef}
						type="file"
					/>

					{hasValidPreview ? (
						// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: drop zone for file input
						<div
							className="group relative overflow-hidden rounded-xl border border-foreground/8"
							onDragOver={(event) => {
								event.preventDefault();
							}}
							onDrop={(event) => {
								event.preventDefault();
								const file = event.dataTransfer.files?.[0];

								if (file) {
									handleUploadFile(file).catch(() => undefined);
								}
							}}
						>
							<div
								className="aspect-video bg-center bg-cover bg-muted/10 bg-no-repeat"
								style={{
									backgroundImage: `url("${selectedRunDraft?.inputImageUrl}")`,
								}}
							/>
							<div className="absolute inset-x-0 bottom-0 flex items-end justify-end gap-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-8 pb-2">
								<button
									className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm transition hover:bg-white/25"
									onClick={() => fileInputRef.current?.click()}
									type="button"
								>
									<Upload className="mr-1 inline size-3" />
									Replace
								</button>
								<button
									aria-label="Clear input image"
									className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-rose-500/60"
									onClick={() => {
										setRunDrafts((current) => ({
											...current,
											[selectedScenario.id]: {
												...(current[selectedScenario.id] ??
													createRunDraft(selectedScenario.id)),
												inputImageUrl: "",
												scenarioId: selectedScenario.id,
												uploadStorage: null,
											},
										}));
									}}
									type="button"
								>
									<Trash2 className="size-3" />
								</button>
							</div>
						</div>
					) : (
						// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: drop zone for file input
						<div
							className="grid gap-3 rounded-xl border border-foreground/10 border-dashed px-3 py-4 transition hover:border-foreground/20 hover:bg-muted/5"
							onDragOver={(event) => {
								event.preventDefault();
							}}
							onDrop={(event) => {
								event.preventDefault();
								const file = event.dataTransfer.files?.[0];

								if (file) {
									handleUploadFile(file).catch(() => undefined);
								}
							}}
						>
							<button
								className="flex items-center gap-2.5 text-left"
								onClick={() => fileInputRef.current?.click()}
								type="button"
							>
								<div className="flex size-9 items-center justify-center rounded-lg bg-muted/15 dark:bg-muted/10">
									{isUploadingImage ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<ImageUp className="size-4 text-muted-foreground" />
									)}
								</div>
								<div className="min-w-0">
									<p className="text-xs">Upload or drop image</p>
									<p className="text-[11px] text-muted-foreground">
										PNG, JPG, WEBP, GIF, AVIF
									</p>
								</div>
							</button>

							{isUploadingImage ? (
								<div className="grid gap-1">
									<div className="h-1 overflow-hidden rounded-full bg-foreground/8">
										<div
											className="h-full rounded-full bg-foreground transition-[width]"
											style={{ width: `${uploadProgressPct}%` }}
										/>
									</div>
									<p className="text-[11px] text-muted-foreground">
										{uploadProgressPct}%
									</p>
								</div>
							) : (
								<div className="flex items-center gap-2">
									<div className="h-px flex-1 bg-foreground/8" />
									<span className="text-[11px] text-muted-foreground">
										or paste URL
									</span>
									<div className="h-px flex-1 bg-foreground/8" />
								</div>
							)}

							<Input
								onChange={(event) => {
									const value = event.target.value;

									setRunDrafts((current) => ({
										...current,
										[selectedScenario.id]: {
											...(current[selectedScenario.id] ??
												createRunDraft(selectedScenario.id)),
											inputImageUrl: value,
											scenarioId: selectedScenario.id,
											uploadStorage: null,
										},
									}));
								}}
								placeholder="https://..."
								value={selectedRunDraft?.inputImageUrl ?? ""}
							/>
						</div>
					)}
				</div>

				{recentReferences.length > 0 ? (
					<div className="grid gap-1.5">
						<SectionLabel>Recent inputs</SectionLabel>
						<RecentInputPicker
							activeUrl={selectedRunDraft?.inputImageUrl ?? ""}
							onSelect={(url) => {
								setRunDrafts((current) => ({
									...current,
									[selectedScenario.id]: {
										...(current[selectedScenario.id] ??
											createRunDraft(selectedScenario.id)),
										inputImageUrl: url,
										scenarioId: selectedScenario.id,
										uploadStorage: null,
									},
								}));
							}}
							references={recentReferences}
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

	const content = (() => {
		if (activeTab === "compose") {
			return renderComposeTab();
		}

		if (activeTab === "launch") {
			return renderLaunchTab();
		}

		return renderRunsTab();
	})();

	const tabs: {
		badge?: number;
		dot?: boolean;
		icon: typeof Sparkles;
		id: ConsoleTab;
		label: string;
		shortcut: string;
	}[] = [
		{ icon: Sparkles, id: "launch", label: "Launch", shortcut: "L" },
		{ icon: Plus, id: "compose", label: "Compose", shortcut: "C" },
		{
			badge: selectedScenarioRuns.length,
			dot: activeRunCount > 0,
			icon: Upload,
			id: "runs",
			label: "Runs",
			shortcut: "R",
		},
	];

	return (
		<section className={cn("studio-surface flex min-h-0 flex-col", className)}>
			<div className="flex items-center justify-between gap-2 px-3 py-2.5">
				<div className="flex items-center gap-2">
					<SectionLabel>Dock</SectionLabel>
					{activeRunCount > 0 ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
							<span className="size-1 animate-pulse rounded-full bg-amber-500" />
							auto-syncing
						</span>
					) : null}
				</div>

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

			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{content}</div>

			{error ? (
				<div className="rounded-b-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
					{error}
				</div>
			) : null}
		</section>
	);
}
