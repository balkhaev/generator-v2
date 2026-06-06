"use client";

import { env } from "@generator/env/web";
import type {
	AdminSnapshot,
	ScenarioParamValue,
	ScenarioRunRecord,
} from "@generator/studio-client/client";
import {
	createStudioScenario,
	getStudioSnapshot,
	launchStudioRun,
	updateStudioScenario,
	uploadStudioInputImage,
} from "@generator/studio-client/client";
import { Button } from "@generator/ui/components/button";
import { ImageUploader } from "@generator/ui/components/image-uploader";
import { Input } from "@generator/ui/components/input";
import { RunProgressIndicator } from "@generator/ui/components/run-progress-indicator";
import { SectionLabel } from "@generator/ui/components/section-label";
import WorkspaceShell from "@generator/ui/components/workspace-shell";
import { cn } from "@generator/ui/lib/utils";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import {
	Download,
	GripVertical,
	Layers,
	Repeat2,
	Sparkles,
	Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const DETAILER_WORKFLOW_KEY = "runpod-flux-detailer";
const DETAILER_SCENARIO_NAME = "Image Detailer";
const POLL_INTERVAL_MS = 2500;
const MAX_RECENT_PICKS = 12;

const httpOrDataUrlPattern = /^(https?:\/\/|data:image\/)/u;
const videoExtensionPattern = /\.(mp4|webm|mov|mkv|gif)$/iu;

interface DetailerSettings {
	denoise: number;
	guidance: number;
	steps: number;
	upscaleBy: number;
}

const DEFAULT_SETTINGS: DetailerSettings = {
	denoise: 0.4,
	guidance: 3.5,
	steps: 20,
	upscaleBy: 1.5,
};

interface DetailerVersion {
	createdAt: string;
	id: string;
	prompt: string;
	resultUrl: string;
	settings: DetailerSettings;
	sourceUrl: string;
}

interface PendingRunMeta {
	prompt: string;
	settings: DetailerSettings;
	sourceUrl: string;
}

function isActiveStatus(status: ScenarioRunRecord["status"]): boolean {
	return status === "queued" || status === "running";
}

function settingsToParams(
	settings: DetailerSettings
): Record<string, ScenarioParamValue> {
	return {
		denoise: settings.denoise,
		guidance: settings.guidance,
		negativePrompt: "",
		steps: settings.steps,
		upscaleBy: settings.upscaleBy,
	};
}

export default function DetailerView({
	initialSnapshot,
}: {
	initialSnapshot: AdminSnapshot;
}) {
	const [snapshot, setSnapshot] = useState(initialSnapshot);
	const [inputUrl, setInputUrl] = useState("");
	const [prompt, setPrompt] = useState("");
	const [settings, setSettings] = useState(DEFAULT_SETTINGS);
	const [activeRunId, setActiveRunId] = useState<string | null>(null);
	const [run, setRun] = useState<ScenarioRunRecord | null>(null);
	const [isLaunching, setLaunching] = useState(false);
	const [versions, setVersions] = useState<DetailerVersion[]>([]);
	const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
	const pendingMetaRef = useRef<Map<string, PendingRunMeta>>(new Map());

	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";
	const adminUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";

	const detailerWorkflow = useMemo(
		() => snapshot.workflows.find((w) => w.key === DETAILER_WORKFLOW_KEY),
		[snapshot.workflows]
	);
	const isAvailable = Boolean(detailerWorkflow);

	const recentPicks = useMemo(() => {
		const seen = new Set<string>();
		const picks: { runId: string; url: string }[] = [];
		for (const record of snapshot.runs) {
			if (record.status !== "succeeded") {
				continue;
			}
			for (const url of record.artifactUrls) {
				if (
					httpOrDataUrlPattern.test(url) &&
					!seen.has(url) &&
					!videoExtensionPattern.test(url)
				) {
					seen.add(url);
					picks.push({ runId: record.id, url });
				}
			}
			if (picks.length >= MAX_RECENT_PICKS) {
				break;
			}
		}
		return picks.slice(0, MAX_RECENT_PICKS);
	}, [snapshot.runs]);

	const refreshRun = useCallback(async () => {
		if (!activeRunId) {
			return;
		}
		try {
			const next = await getStudioSnapshot();
			setSnapshot(next);
			const updated = next.runs.find((record) => record.id === activeRunId);
			if (updated) {
				setRun(updated);
			}
		} catch {
			// Network blip — keep polling on the next tick.
		}
	}, [activeRunId]);

	useEffect(() => {
		if (!activeRunId || (run && !isActiveStatus(run.status))) {
			return;
		}
		const timer = setInterval(() => {
			refreshRun().catch(() => undefined);
		}, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [activeRunId, run, refreshRun]);

	useEffect(() => {
		if (run?.status !== "succeeded") {
			return;
		}
		const resultUrl = run.artifactUrls[0];
		if (!resultUrl) {
			return;
		}
		const completedRun = run;
		setVersions((prev) => {
			if (prev.some((version) => version.id === completedRun.id)) {
				return prev;
			}
			const meta = pendingMetaRef.current.get(completedRun.id);
			const version: DetailerVersion = {
				createdAt: completedRun.createdAt,
				id: completedRun.id,
				prompt: meta?.prompt ?? "",
				resultUrl,
				settings: meta?.settings ?? DEFAULT_SETTINGS,
				sourceUrl: meta?.sourceUrl ?? completedRun.inputImageUrl,
			};
			return [version, ...prev];
		});
		setActiveVersionId(completedRun.id);
	}, [run]);

	const activeVersion = useMemo(
		() => versions.find((version) => version.id === activeVersionId) ?? null,
		[activeVersionId, versions]
	);

	const handleUseAsSource = useCallback((url: string) => {
		setInputUrl(url);
		toast.success("Loaded result as new source.");
	}, []);

	const ensureDetailerScenario = useCallback(async (): Promise<string> => {
		const existing = snapshot.scenarios.find(
			(scenario) => scenario.workflowKey === DETAILER_WORKFLOW_KEY
		);
		if (existing) {
			return existing.id;
		}
		const created = await createStudioScenario({
			name: DETAILER_SCENARIO_NAME,
			params: settingsToParams(settings),
			prompt: "",
			workflowKey: DETAILER_WORKFLOW_KEY,
		});
		setSnapshot((prev) => ({
			...prev,
			scenarios: [created.data, ...prev.scenarios],
		}));
		return created.data.id;
	}, [settings, snapshot.scenarios]);

	const handleRun = useCallback(async () => {
		const trimmedUrl = inputUrl.trim();
		if (!trimmedUrl) {
			toast.error("Add a source image first.");
			return;
		}
		setLaunching(true);
		try {
			const scenarioId = await ensureDetailerScenario();
			await updateStudioScenario(scenarioId, {
				params: settingsToParams(settings),
			});
			const trimmedPrompt = prompt.trim();
			const result = await launchStudioRun({
				inputImageUrl: trimmedUrl,
				scenarioId,
				...(trimmedPrompt ? { promptOverride: trimmedPrompt } : {}),
			});
			pendingMetaRef.current.set(result.data.id, {
				prompt: trimmedPrompt,
				settings,
				sourceUrl: trimmedUrl,
			});
			setActiveRunId(result.data.id);
			setRun(result.data);
			toast.success("Detailer started.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to start detailer."
			);
		} finally {
			setLaunching(false);
		}
	}, [ensureDetailerScenario, inputUrl, prompt, settings]);

	const isBusy = isLaunching || (run !== null && isActiveStatus(run.status));

	return (
		<WorkspaceShell
			navigation={[
				...createWorkspaceNavigation("studio", {
					admin: adminUrl,
					persons: personsUrl,
					shots: "/shots",
					studio: "/",
				}),
				{
					current: true,
					href: "/detailer",
					icon: Sparkles,
					label: "Detailer",
					shortLabel: "Det",
				},
			]}
			subtitle="Upscale and re-detail a single image with Flux img2img."
			title="Detailer"
			workspaceLabel="Studio"
		>
			<div className="grid h-full min-h-0 gap-3 overflow-y-auto xl:grid-cols-[22rem_minmax(0,1fr)] xl:overflow-hidden">
				<section className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-foreground/6 bg-background/60 p-4">
					{isAvailable ? null : (
						<p className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
							The Flux detailer endpoint is not configured on this environment.
							Generation will fail until the RunPod Flux workflow is enabled.
						</p>
					)}

					<div className="grid gap-1.5">
						<SectionLabel>Source image</SectionLabel>
						<ImageUploader
							helperText="Drop, browse, or paste an image to detail"
							onChange={setInputUrl}
							onError={(message) => toast.error(message)}
							upload={(file) => uploadStudioInputImage({ file })}
							value={inputUrl}
						/>
						<Input
							onChange={(event) => setInputUrl(event.target.value)}
							placeholder="…or paste an image URL"
							value={inputUrl}
						/>
					</div>

					{recentPicks.length > 0 ? (
						<div className="grid gap-1.5">
							<SectionLabel>Recent outputs</SectionLabel>
							<div className="flex flex-wrap gap-1.5">
								{recentPicks.map((pick) => (
									<button
										aria-label="Use this image"
										className="size-14 overflow-hidden rounded-md border border-foreground/10 transition hover:ring-2 hover:ring-ring/60"
										key={pick.url}
										onClick={() => setInputUrl(pick.url)}
										style={{
											backgroundImage: `url("${pick.url}")`,
											backgroundPosition: "center",
											backgroundSize: "cover",
										}}
										type="button"
									/>
								))}
							</div>
						</div>
					) : null}

					<div className="grid gap-1.5">
						<SectionLabel>Prompt (optional)</SectionLabel>
						<Input
							onChange={(event) => setPrompt(event.target.value)}
							placeholder="e.g. highly detailed skin texture, sharp focus"
							value={prompt}
						/>
					</div>

					<DetailerSlider
						hint="Lower keeps the original, higher invents more detail."
						label="Detail strength"
						max={1}
						min={0.05}
						onChange={(denoise) =>
							setSettings((prev) => ({ ...prev, denoise }))
						}
						step={0.05}
						value={settings.denoise}
					/>
					<DetailerSlider
						hint="Resolution multiplier applied before the detail pass."
						label="Upscale"
						max={2}
						min={1}
						onChange={(upscaleBy) =>
							setSettings((prev) => ({ ...prev, upscaleBy }))
						}
						step={0.1}
						suffix="×"
						value={settings.upscaleBy}
					/>
					<DetailerSlider
						hint="Denoising steps for the detail pass."
						label="Steps"
						max={40}
						min={4}
						onChange={(steps) =>
							setSettings((prev) => ({ ...prev, steps: Math.round(steps) }))
						}
						step={1}
						value={settings.steps}
					/>

					<Button
						className="mt-auto"
						disabled={isBusy || !inputUrl.trim()}
						onClick={() => {
							handleRun().catch(() => undefined);
						}}
						size="lg"
					>
						<Wand2 className="size-4" />
						{isBusy ? "Detailing…" : "Detail image"}
					</Button>
				</section>

				<section className="min-h-0 overflow-hidden rounded-lg border border-foreground/6 bg-background/60">
					<DetailerResult
						activeVersion={activeVersion}
						inputUrl={inputUrl}
						onSelectVersion={setActiveVersionId}
						onUseAsSource={handleUseAsSource}
						run={run}
						versions={versions}
					/>
				</section>
			</div>
		</WorkspaceShell>
	);
}

function DetailerSlider({
	hint,
	label,
	max,
	min,
	onChange,
	step,
	suffix,
	value,
}: {
	hint: string;
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	step: number;
	suffix?: string;
	value: number;
}) {
	return (
		<div className="grid gap-1">
			<div className="flex items-center justify-between">
				<SectionLabel>{label}</SectionLabel>
				<span className="font-mono text-muted-foreground text-xs">
					{value}
					{suffix ?? ""}
				</span>
			</div>
			<input
				className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-foreground/15 accent-[var(--workspace-accent,theme(colors.primary.DEFAULT))]"
				max={max}
				min={min}
				onChange={(event) => onChange(Number(event.target.value))}
				step={step}
				type="range"
				value={value}
			/>
			<p className="text-[11px] text-muted-foreground">{hint}</p>
		</div>
	);
}

function formatVersionMeta(version: DetailerVersion): string {
	return `denoise ${version.settings.denoise} · upscale ${version.settings.upscaleBy}× · ${version.settings.steps} steps`;
}

function DetailerResult({
	activeVersion,
	inputUrl,
	onSelectVersion,
	onUseAsSource,
	run,
	versions,
}: {
	activeVersion: DetailerVersion | null;
	inputUrl: string;
	onSelectVersion: (id: string) => void;
	onUseAsSource: (url: string) => void;
	run: ScenarioRunRecord | null;
	versions: DetailerVersion[];
}) {
	const hasInput = inputUrl.trim().length > 0;
	const isRunning = run !== null && isActiveStatus(run.status);
	const isFailed = run?.status === "failed";
	const beforeUrl = activeVersion?.sourceUrl ?? (hasInput ? inputUrl : null);

	if (!(hasInput || activeVersion || run)) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
				<Sparkles className="size-8 opacity-40" />
				<p className="text-sm">
					Pick a source image and run the detailer to see the result here.
				</p>
			</div>
		);
	}

	return (
		<div className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-3 p-3">
			<div className="relative min-h-0 overflow-hidden rounded-lg border border-foreground/8 bg-muted/10">
				{activeVersion ? (
					<BeforeAfterSlider
						afterUrl={activeVersion.resultUrl}
						beforeUrl={activeVersion.sourceUrl}
						key={activeVersion.id}
					/>
				) : (
					<div className="relative h-full w-full">
						{beforeUrl ? (
							<div
								className="h-full w-full bg-center bg-contain bg-no-repeat"
								style={{ backgroundImage: `url("${beforeUrl}")` }}
							/>
						) : null}
						<span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white uppercase tracking-wider">
							Source
						</span>
					</div>
				)}

				{isRunning && run ? (
					<div className="absolute inset-0 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
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
							variant="circle"
						/>
					</div>
				) : null}

				{isFailed && !activeVersion ? (
					<div className="absolute inset-0 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
						<p className="max-w-xs text-center text-destructive text-xs">
							{run?.errorSummary ?? "Detailer run failed."}
						</p>
					</div>
				) : null}
			</div>

			<div className="flex flex-col gap-2">
				{activeVersion ? (
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="font-mono text-[11px] text-muted-foreground">
							{formatVersionMeta(activeVersion)}
						</p>
						<div className="flex gap-2">
							<Button
								onClick={() => onUseAsSource(activeVersion.resultUrl)}
								size="sm"
								variant="outline"
							>
								<Repeat2 className="size-4" />
								Use as source
							</Button>
							<Button
								render={
									<a
										download
										href={activeVersion.resultUrl}
										rel="noopener"
										target="_blank"
									>
										<Download className="size-4" />
										Download
									</a>
								}
								size="sm"
								variant="outline"
							/>
						</div>
					</div>
				) : null}

				{isFailed && activeVersion ? (
					<p className="text-destructive text-xs">
						Last run failed: {run?.errorSummary ?? "unknown error"}
					</p>
				) : null}

				{versions.length > 0 ? (
					<VersionFilmstrip
						activeId={activeVersion?.id ?? null}
						onSelect={onSelectVersion}
						versions={versions}
					/>
				) : null}
			</div>
		</div>
	);
}

function VersionFilmstrip({
	activeId,
	onSelect,
	versions,
}: {
	activeId: string | null;
	onSelect: (id: string) => void;
	versions: DetailerVersion[];
}) {
	return (
		<div className="grid gap-1">
			<div className="flex items-center gap-1.5">
				<Layers className="size-3 text-muted-foreground" />
				<SectionLabel>Versions</SectionLabel>
			</div>
			<div className="flex gap-1.5 overflow-x-auto pb-1">
				{versions.map((version, index) => {
					const number = versions.length - index;
					const isActive = version.id === activeId;
					return (
						<button
							aria-label={`Version ${number}`}
							aria-pressed={isActive}
							className={cn(
								"relative size-16 shrink-0 overflow-hidden rounded-md border bg-center bg-cover transition",
								isActive
									? "border-ring ring-2 ring-ring/60"
									: "border-foreground/10 hover:border-foreground/35"
							)}
							key={version.id}
							onClick={() => onSelect(version.id)}
							style={{ backgroundImage: `url("${version.resultUrl}")` }}
							type="button"
						>
							<span className="absolute bottom-0 left-0 rounded-tr-md bg-black/65 px-1.5 py-0.5 font-mono text-[9px] text-white">
								v{number}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function BeforeAfterSlider({
	afterUrl,
	beforeUrl,
}: {
	afterUrl: string;
	beforeUrl: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const [position, setPosition] = useState(50);

	const updateFromClientX = useCallback((clientX: number) => {
		const element = containerRef.current;
		if (!element) {
			return;
		}
		const rect = element.getBoundingClientRect();
		if (rect.width === 0) {
			return;
		}
		const pct = ((clientX - rect.left) / rect.width) * 100;
		setPosition(Math.min(100, Math.max(0, pct)));
	}, []);

	useEffect(() => {
		function handleMove(event: PointerEvent) {
			if (draggingRef.current) {
				updateFromClientX(event.clientX);
			}
		}
		function handleUp() {
			draggingRef.current = false;
		}
		window.addEventListener("pointermove", handleMove, { passive: true });
		window.addEventListener("pointerup", handleUp, { passive: true });
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
		};
	}, [updateFromClientX]);

	return (
		<div
			aria-label="Before/after comparison"
			aria-orientation="vertical"
			aria-valuemax={100}
			aria-valuemin={0}
			aria-valuenow={Math.round(position)}
			className="relative h-full w-full cursor-ew-resize touch-none select-none"
			onKeyDown={(event) => {
				if (event.key === "ArrowLeft") {
					setPosition((prev) => Math.max(0, prev - 2));
				} else if (event.key === "ArrowRight") {
					setPosition((prev) => Math.min(100, prev + 2));
				}
			}}
			onPointerDown={(event) => {
				draggingRef.current = true;
				updateFromClientX(event.clientX);
			}}
			ref={containerRef}
			role="slider"
			tabIndex={0}
		>
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-center bg-contain bg-no-repeat"
				style={{ backgroundImage: `url("${beforeUrl}")` }}
			/>
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-center bg-contain bg-no-repeat"
				style={{
					backgroundImage: `url("${afterUrl}")`,
					clipPath: `inset(0 ${100 - position}% 0 0)`,
				}}
			/>
			<span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white uppercase tracking-wider">
				After
			</span>
			<span className="absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white uppercase tracking-wider">
				Before
			</span>
			<div
				aria-hidden="true"
				className="absolute top-0 bottom-0 z-10 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
				style={{ left: `${position}%` }}
			>
				<span className="absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-black shadow">
					<GripVertical className="size-4" />
				</span>
			</div>
		</div>
	);
}
