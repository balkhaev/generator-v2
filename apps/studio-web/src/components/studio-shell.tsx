"use client";

import { authClient } from "@generator/auth-client";
import { env } from "@generator/env/web";
import type {
	AdminSnapshot,
	ScenarioRecord,
	ScenarioRunRecord,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { SectionLabel } from "@generator/ui/components/section-label";
import WorkspaceShell, {
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { cn } from "@generator/ui/lib/utils";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import { Activity, Clock3, Film, MonitorPlay, Play } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import ScenarioConsole from "@/components/scenario-console";

interface ScenarioCardData {
	duration: string;
	id: string;
	latestRun: ScenarioRunRecord | null;
	name: string;
	prompt: string;
	runCount: number;
	status: "draft" | "failed" | "queued" | "ready" | "running";
	updatedAt: string | null;
	workflowKey: string;
}

export interface StudioMediaAsset {
	createdAt: string;
	id: string;
	label: string;
	mediaKind: "input" | "output";
	mediaType: "image" | "video";
	meta: string;
	runId: string;
	scenarioId: string;
	status: ScenarioRunRecord["status"];
	url: string;
}

const scenarioStatusDot: Record<ScenarioCardData["status"], string> = {
	draft: "bg-muted-foreground/40",
	failed: "bg-rose-500",
	queued: "bg-sky-500",
	ready: "bg-emerald-500",
	running: "bg-amber-500",
};

const videoExtensionPattern = /\.(mp4|mov|webm)(\?.*)?$/i;
const videoDataUriPattern = /^data:video\//i;
const emptyCaptionTrack = "data:text/vtt;charset=utf-8,WEBVTT";

function buildStudioHref(
	pathname: string,
	currentSearch: string,
	input: {
		assetId?: string | null;
		runId?: string | null;
		scenarioId?: string | null;
		tab?: string | null;
	}
) {
	const params = new URLSearchParams(currentSearch);

	if (input.assetId === null) {
		params.delete("asset");
	} else if (typeof input.assetId === "string") {
		params.set("asset", input.assetId);
	}

	if (input.runId === null) {
		params.delete("run");
	} else if (typeof input.runId === "string") {
		params.set("run", input.runId);
	}

	if (input.scenarioId === null) {
		params.delete("scenario");
	} else if (typeof input.scenarioId === "string") {
		params.set("scenario", input.scenarioId);
	}

	if (input.tab === null) {
		params.delete("tab");
	} else if (typeof input.tab === "string") {
		params.set("tab", input.tab);
	}

	const nextSearch = params.toString();
	return (nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route;
}

function getScenarioDuration(params: ScenarioRecord["params"]) {
	const safeParams = params ?? {};
	const frameRate =
		typeof safeParams.frameRate === "number"
			? safeParams.frameRate
			: Number(safeParams.frameRate);
	const numFrames =
		typeof safeParams.numFrames === "number"
			? safeParams.numFrames
			: Number(safeParams.numFrames);

	if (
		Number.isFinite(frameRate) &&
		Number.isFinite(numFrames) &&
		frameRate > 0
	) {
		return `${(numFrames / frameRate).toFixed(1)}s`;
	}

	return "n/a";
}

function getScenarioStatus(runs: ScenarioRunRecord[]) {
	const latestRun = runs[0] ?? null;

	if (!latestRun) {
		return "draft" as const;
	}

	switch (latestRun.status) {
		case "failed":
			return "failed";
		case "queued":
			return "queued";
		case "running":
			return "running";
		case "succeeded":
			return "ready";
		default:
			return "draft";
	}
}

function getMediaType(url: string): StudioMediaAsset["mediaType"] {
	if (videoExtensionPattern.test(url) || videoDataUriPattern.test(url)) {
		return "video";
	}

	return "image";
}

function renderAssetPreview(asset: StudioMediaAsset) {
	if (asset.mediaType === "video") {
		return (
			<video
				className="h-full w-full bg-black/90 object-contain"
				controls
				preload="metadata"
				src={asset.url}
			>
				<track
					default
					kind="captions"
					label="Captions unavailable"
					src={emptyCaptionTrack}
					srcLang="en"
				/>
			</video>
		);
	}

	return (
		<div
			aria-label={asset.label}
			className="h-full w-full bg-center bg-contain bg-no-repeat"
			role="img"
			style={{ backgroundImage: `url("${asset.url}")` }}
		/>
	);
}

function buildScenarioCards(
	scenarios: ScenarioRecord[],
	runs: ScenarioRunRecord[]
): ScenarioCardData[] {
	return scenarios.map((scenario) => {
		const scenarioRuns = runs.filter((run) => run.scenarioId === scenario.id);

		return {
			duration: getScenarioDuration(scenario.params),
			id: scenario.id,
			latestRun: scenarioRuns[0] ?? null,
			name: scenario.name,
			prompt: scenario.prompt,
			runCount: scenarioRuns.length,
			status: getScenarioStatus(scenarioRuns),
			updatedAt: scenario.updatedAt ?? scenario.createdAt ?? null,
			workflowKey: scenario.workflowKey,
		};
	});
}

function buildMediaAssets(runs: ScenarioRunRecord[]): StudioMediaAsset[] {
	return runs.flatMap((run) => {
		const assets: StudioMediaAsset[] = [];

		for (const [index, url] of run.artifactUrls.entries()) {
			assets.push({
				createdAt: run.createdAt,
				id: `output-${run.id}-${index}`,
				label: `${run.scenarioName} output ${index + 1}`,
				mediaKind: "output",
				mediaType: getMediaType(url),
				meta: run.scenarioName,
				runId: run.id,
				scenarioId: run.scenarioId,
				status: run.status,
				url,
			});
		}

		if (run.inputImageUrl) {
			assets.push({
				createdAt: run.createdAt,
				id: `input-${run.id}`,
				label: run.inputLabel,
				mediaKind: "input",
				mediaType: getMediaType(run.inputImageUrl),
				meta: run.scenarioName,
				runId: run.id,
				scenarioId: run.scenarioId,
				status: run.status,
				url: run.inputImageUrl,
			});
		}

		return assets;
	});
}

function ScenarioRail({
	getHref,
	scenarios,
	selectedScenarioId,
}: {
	getHref: (scenarioId: string) => Route;
	scenarios: ScenarioCardData[];
	selectedScenarioId: string | null;
}) {
	return (
		<div className="studio-surface flex min-h-0 flex-col">
			<div className="px-3 py-3">
				<SectionLabel>Scenarios</SectionLabel>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{scenarios.length === 0 ? (
					<EmptyState
						hint="Create one from the dock on the right."
						message="No scenarios yet."
					/>
				) : (
					<div className="grid gap-0.5">
						{scenarios.map((scenario) => {
							const isActive = scenario.id === selectedScenarioId;

							return (
								<Link
									aria-current={isActive ? "true" : undefined}
									className={cn(
										"grid gap-1 rounded-lg px-3 py-2.5 text-left transition",
										isActive
											? "bg-foreground text-background"
											: "hover:bg-muted/20 dark:hover:bg-muted/10"
									)}
									href={getHref(scenario.id)}
									key={scenario.id}
									scroll={false}
								>
									<div className="flex items-center gap-2">
										<span
											className={cn(
												"size-1.5 shrink-0 rounded-full",
												isActive
													? "bg-background"
													: scenarioStatusDot[scenario.status]
											)}
										/>
										<p className="min-w-0 truncate text-sm">{scenario.name}</p>
									</div>
									<div
										className={cn(
											"flex items-center gap-2 pl-3.5 text-[11px]",
											isActive ? "text-background/65" : "text-muted-foreground"
										)}
									>
										<span>{scenario.workflowKey}</span>
										<span className="flex items-center gap-0.5">
											<Clock3 className="size-3" />
											{scenario.duration}
										</span>
										<span className="flex items-center gap-0.5">
											<Activity className="size-3" />
											{scenario.runCount}
										</span>
									</div>
								</Link>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function PreviewSurface({ asset }: { asset: StudioMediaAsset | null }) {
	return (
		<div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black/5 dark:bg-black/30">
			{asset ? (
				<div className="relative flex h-full items-center justify-center overflow-hidden">
					{renderAssetPreview(asset)}

					<div className="absolute right-2 bottom-2 left-2 flex items-center gap-2 rounded-lg bg-background/80 px-3 py-2 backdrop-blur-lg dark:bg-background/60">
						<span
							className={cn(
								"rounded-full px-2 py-0.5 text-[11px]",
								asset.mediaKind === "output"
									? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
									: "bg-sky-500/10 text-sky-600 dark:text-sky-400"
							)}
						>
							{asset.mediaKind}
						</span>
						{asset.mediaType === "video" ? (
							<span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-600 dark:text-purple-400">
								<Film className="size-3" />
								video
							</span>
						) : null}
						<span className="min-w-0 truncate text-xs">{asset.label}</span>
					</div>
				</div>
			) : (
				<div className="studio-aurora flex h-full items-center justify-center">
					<div className="grid max-w-xs gap-3 text-center">
						<div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted/15 dark:bg-muted/10">
							<MonitorPlay
								className="size-5 text-muted-foreground/60"
								strokeWidth={1.5}
							/>
						</div>
						<p className="text-muted-foreground text-sm">No media selected</p>
						<p className="text-muted-foreground/60 text-xs leading-relaxed">
							Upload a source image and queue a run to see results here.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

function MediaStrip({
	assets,
	getHref,
	selectedMediaId,
}: {
	assets: StudioMediaAsset[];
	getHref: (mediaId: string) => Route;
	selectedMediaId: string | null;
}) {
	if (assets.length === 0) {
		return null;
	}

	return (
		<div className="flex gap-1.5 overflow-x-auto px-1 py-1">
			{assets.map((asset) => {
				const isActive = asset.id === selectedMediaId;
				const isVideo = asset.mediaType === "video";

				return (
					<Link
						aria-current={isActive ? "true" : undefined}
						className={cn(
							"group relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg transition",
							isActive
								? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
								: "opacity-70 hover:opacity-100"
						)}
						href={getHref(asset.id)}
						key={asset.id}
						scroll={false}
						title={asset.label}
					>
						{isVideo ? (
							<div className="flex h-full w-full items-center justify-center bg-black/80">
								<Play className="size-5 text-white/70" fill="currentColor" />
							</div>
						) : (
							<div
								className="absolute inset-0 bg-center bg-cover"
								style={{ backgroundImage: `url("${asset.url}")` }}
							/>
						)}
						<span
							className={cn(
								"absolute top-0.5 right-0.5 size-1.5 rounded-full",
								asset.mediaKind === "output" ? "bg-emerald-500" : "bg-sky-500"
							)}
						/>
					</Link>
				);
			})}
		</div>
	);
}

export default function StudioShell({
	initialSnapshot,
	sessionName,
}: {
	initialSnapshot: AdminSnapshot;
	sessionName: string;
}) {
	const [snapshot, setSnapshot] = useState<AdminSnapshot>(initialSnapshot);
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const currentSearch = searchParams.toString();
	const scenarioCards = useMemo(
		() => buildScenarioCards(snapshot.scenarios, snapshot.runs),
		[snapshot.runs, snapshot.scenarios]
	);
	const mediaAssets = useMemo(
		() => buildMediaAssets(snapshot.runs),
		[snapshot.runs]
	);
	const requestedRunId = searchParams.get("run");
	const requestedRun =
		(requestedRunId
			? snapshot.runs.find(
					(run) =>
						run.id === requestedRunId || run.providerJobId === requestedRunId
				)
			: null) ?? null;
	const requestedScenarioId = searchParams.get("scenario");
	const selectedScenarioId =
		(requestedScenarioId &&
		scenarioCards.some((scenario) => scenario.id === requestedScenarioId)
			? requestedScenarioId
			: null) ??
		requestedRun?.scenarioId ??
		scenarioCards[0]?.id ??
		null;

	useEffect(() => {
		if (requestedScenarioId === selectedScenarioId) {
			return;
		}

		router.replace(
			buildStudioHref(pathname, currentSearch, {
				assetId: null,
				runId: requestedRunId,
				scenarioId: selectedScenarioId,
			}),
			{
				scroll: false,
			}
		);
	}, [
		currentSearch,
		pathname,
		requestedRunId,
		requestedScenarioId,
		router,
		selectedScenarioId,
	]);

	const selectedScenarioCard =
		scenarioCards.find((scenario) => scenario.id === selectedScenarioId) ??
		null;
	const selectedScenarioAssets = useMemo(() => {
		if (!selectedScenarioId) {
			return mediaAssets;
		}

		return mediaAssets.filter(
			(asset) => asset.scenarioId === selectedScenarioId
		);
	}, [mediaAssets, selectedScenarioId]);
	const requestedAssetId = searchParams.get("asset");
	const selectedMediaId =
		(requestedAssetId &&
		selectedScenarioAssets.some((asset) => asset.id === requestedAssetId)
			? requestedAssetId
			: null) ??
		selectedScenarioAssets[0]?.id ??
		null;

	useEffect(() => {
		if (requestedAssetId === selectedMediaId) {
			return;
		}

		router.replace(
			buildStudioHref(pathname, currentSearch, {
				assetId: selectedMediaId,
				runId: requestedRunId,
			}),
			{
				scroll: false,
			}
		);
	}, [
		currentSearch,
		pathname,
		requestedAssetId,
		requestedRunId,
		router,
		selectedMediaId,
	]);

	const selectedMediaAsset =
		selectedScenarioAssets.find((asset) => asset.id === selectedMediaId) ??
		selectedScenarioAssets[0] ??
		null;

	function handleSignOut() {
		authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					window.location.href = "/login";
				},
			},
		});
	}

	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";
	const adminUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";

	function handleScenarioSelect(scenarioId: string) {
		router.push(
			buildStudioHref(pathname, currentSearch, {
				assetId: null,
				runId: null,
				scenarioId,
			}),
			{
				scroll: false,
			}
		);
	}

	function getScenarioHref(scenarioId: string) {
		return buildStudioHref(pathname, currentSearch, {
			assetId: null,
			runId: null,
			scenarioId,
		});
	}

	function getMediaHref(mediaId: string) {
		return buildStudioHref(pathname, currentSearch, {
			assetId: mediaId,
			runId: requestedRunId,
		});
	}

	return (
		<WorkspaceShell
			actions={
				<Button onClick={handleSignOut} size="sm" variant="outline">
					{sessionName}
				</Button>
			}
			context={
				<ScenarioRail
					getHref={getScenarioHref}
					scenarios={scenarioCards}
					selectedScenarioId={selectedScenarioId}
				/>
			}
			inspector={
				<ScenarioConsole
					className="h-full"
					onScenarioSelect={handleScenarioSelect}
					onSnapshotChange={setSnapshot}
					selectedScenarioId={selectedScenarioId}
					snapshot={snapshot}
				/>
			}
			navigation={createWorkspaceNavigation("studio", {
				admin: adminUrl,
				persons: personsUrl,
				studio: "/",
			})}
			status={
				<>
					<WorkspaceStatus tone="info">
						{selectedScenarioCard?.workflowKey ?? "scenario"}
					</WorkspaceStatus>
					<WorkspaceStatus tone="neutral">
						{selectedScenarioAssets.length} assets
					</WorkspaceStatus>
					<WorkspaceStatus tone="success">
						{snapshot.runs.length} runs
					</WorkspaceStatus>
				</>
			}
			subtitle={
				selectedScenarioCard
					? `${selectedScenarioCard.duration} · ${selectedScenarioCard.runCount} runs`
					: `${snapshot.scenarios.length} scenarios ready to launch`
			}
			title={selectedScenarioCard?.name ?? "Studio"}
			workspaceLabel="Studio"
		>
			<div className="flex h-full min-h-0 flex-col gap-2">
				<PreviewSurface asset={selectedMediaAsset} />
				<MediaStrip
					assets={selectedScenarioAssets}
					getHref={getMediaHref}
					selectedMediaId={selectedMediaId}
				/>
			</div>
		</WorkspaceShell>
	);
}
