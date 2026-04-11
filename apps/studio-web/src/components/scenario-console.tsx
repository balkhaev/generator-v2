"use client";

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
import { formatDateTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import {
	ChevronDown,
	ExternalLink,
	ImageUp,
	Loader2,
	Package2,
	Play,
	Plus,
	RefreshCw,
	RotateCw,
	Sparkles,
	Upload,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface ScenarioConsoleProps {
	className?: string;
	onScenarioSelect?: (scenarioId: string) => void;
	onSnapshotChange?: (snapshot: AdminSnapshot) => void;
	selectedScenarioId: string | null;
	snapshot: AdminSnapshot;
}

type ConsoleTab = "compose" | "launch" | "runs";
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

const presetStatusTone: Record<PresetReadiness["status"], string> = {
	missing: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	partial: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};
const adminWebUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";

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

const formatDate = formatDateTime;

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

function StatusPill({ status }: { status: ScenarioRunRecord["status"] }) {
	return (
		<span
			className={cn(
				"rounded-full px-2 py-0.5 text-[11px]",
				runStatusTone[status]
			)}
		>
			{status}
		</span>
	);
}

function DockMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg bg-muted/10 px-2.5 py-2 dark:bg-muted/5">
			<p className="text-[11px] text-muted-foreground">{label}</p>
			<p className="mt-0.5 text-sm">{value}</p>
		</div>
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
					<button
						className={cn(
							"group relative aspect-square overflow-hidden rounded-lg transition",
							isActive
								? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
								: "opacity-70 hover:opacity-100"
						)}
						key={run.id}
						onClick={() => onSelect(run.inputImageUrl)}
						type="button"
					>
						<div
							className="absolute inset-0 bg-center bg-cover"
							style={{ backgroundImage: `url("${run.inputImageUrl}")` }}
						/>
						<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pt-3 pb-1">
							<p className="truncate text-center text-[10px] text-white leading-tight">
								{run.inputLabel}
							</p>
						</div>
					</button>
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
	const [linkedPerson, setLinkedPerson] = useState<LinkedPersonState>(null);
	const [submittingRunId, setSubmittingRunId] = useState<string | null>(null);
	const [syncingRunId, setSyncingRunId] = useState<string | null>(null);
	const [uploadProgressPct, setUploadProgressPct] = useState(0);
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
		if (silent) {
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
								rel="noreferrer"
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
												rel="noreferrer"
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
						{selectedWorkflow.parameters.map((parameter) => (
							<div className="grid gap-1" key={parameter.key}>
								<Label className="text-xs" htmlFor={parameter.key}>
									{parameter.label}
								</Label>
								<Input
									id={parameter.key}
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
												: current
										);
									}}
									placeholder={parameter.defaultValue || parameter.label}
									value={scenarioForm.params[parameter.key] ?? ""}
								/>
								<p className="line-clamp-1 text-[11px] text-muted-foreground">
									{parameter.helperText}
								</p>
							</div>
						))}
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

	function renderLaunchTab() {
		if (!selectedScenario) {
			return (
				<EmptyState
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

		return (
			<div className="grid gap-3">
				<div className="grid grid-cols-3 gap-1.5">
					<DockMetric
						label="Runs"
						value={String(selectedScenarioRuns.length)}
					/>
					<DockMetric
						label="Duration"
						value={formatScenarioDuration(selectedScenario.params)}
					/>
					<DockMetric
						label="Input"
						value={
							storageLabel ?? (selectedRunDraft?.inputImageUrl ? "URL" : "None")
						}
					/>
				</div>

				<div className="grid gap-2">
					<SectionLabel>Input image</SectionLabel>
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
							<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pt-8 pb-2.5">
								<div className="min-w-0">
									{storageLabel ? (
										<span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur-sm">
											{storageLabel}
										</span>
									) : null}
								</div>
								<div className="flex items-center gap-1.5">
									<button
										className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm transition hover:bg-white/25"
										onClick={() => fileInputRef.current?.click()}
										type="button"
									>
										Change
									</button>
									<button
										className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm transition hover:bg-rose-500/50"
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
										Clear
									</button>
								</div>
							</div>
						</div>
					) : (
						<div
							className="grid gap-3 rounded-xl border border-foreground/10 border-dashed px-3 py-3 transition hover:border-foreground/20 hover:bg-muted/5"
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
					disabled={submittingRunId === selectedScenario.id || isUploadingImage}
					onClick={() => handleLaunchRun(selectedScenario)}
					size="sm"
				>
					{submittingRunId === selectedScenario.id ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Play className="size-3.5" />
					)}
					Launch
				</Button>
			</div>
		);
	}

	function renderRunsTab() {
		if (selectedScenarioRuns.length === 0) {
			return (
				<EmptyState
					hint="Launch a scenario and sync it from this panel."
					message="No runs yet."
				/>
			);
		}

		return (
			<div className="grid gap-2">
				{selectedScenarioRuns.map((run) => (
					<article
						className={cn(
							"grid gap-2 rounded-lg bg-muted/8 p-3 dark:bg-muted/5",
							(focusedRunId === run.id || focusedRunId === run.providerJobId) &&
								"ring-1 ring-foreground/20"
						)}
						key={run.id}
					>
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0">
								<p className="truncate text-xs">{run.scenarioName}</p>
								<p className="truncate text-[11px] text-muted-foreground">
									{run.providerJobId ?? "pending"}
								</p>
							</div>
							<StatusPill status={run.status} />
						</div>

						<div className="grid grid-cols-2 gap-1.5">
							<DockMetric label="Created" value={formatDate(run.createdAt)} />
							<DockMetric label="Input" value={run.inputLabel} />
						</div>

						{run.errorSummary ? (
							<p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-rose-700 text-xs dark:text-rose-300">
								{run.errorSummary}
							</p>
						) : null}

						<div className="flex flex-wrap items-center gap-1.5">
							{linkedPerson &&
							(linkedPerson.runId === run.id ||
								linkedPerson.runId === run.providerJobId) ? (
								<a
									className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
									href={`${personsUrl}?person=${linkedPerson.personSlug}`}
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
									disabled={syncingRunId === run.id}
									onClick={() => handleSyncRun(run.id)}
									size="sm"
									variant="outline"
								>
									{syncingRunId === run.id ? (
										<Loader2 className="size-3.5 animate-spin" />
									) : (
										<RotateCw className="size-3.5" />
									)}
									Sync
								</Button>
							) : null}
						</div>
					</article>
				))}
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

	return (
		<section className={cn("studio-surface flex min-h-0 flex-col", className)}>
			<div className="flex items-center justify-between gap-2 px-3 py-2.5">
				<div className="flex items-center gap-2">
					<SectionLabel>Dock</SectionLabel>
					<span className="rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-muted/8">
						{snapshot.source}
					</span>
				</div>

				<button
					className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted/15 hover:text-foreground"
					onClick={() => {
						loadSnapshot({ silent: true }).catch(() => undefined);
					}}
					type="button"
				>
					{isRefreshing ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<RefreshCw className="size-3.5" />
					)}
				</button>
			</div>

			<ScenarioInfoHeader scenario={selectedScenario} />

			<div className="flex items-center gap-0.5 border-foreground/6 border-b px-3 py-1.5 dark:border-foreground/10">
				{[
					{ icon: Sparkles, id: "launch", label: "Launch" },
					{ icon: Plus, id: "compose", label: "Compose" },
					{ icon: Upload, id: "runs", label: "Runs" },
				].map((tab) => {
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
							href={buildConsoleHref(
								pathname,
								currentSearch,
								tab.id as ConsoleTab
							)}
							key={tab.id}
							scroll={false}
						>
							<Icon className="size-3.5" />
							{tab.label}
						</Link>
					);
				})}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{content}</div>

			{error ? (
				<div className="rounded-b-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
					{error}
				</div>
			) : null}
		</section>
	);
}
