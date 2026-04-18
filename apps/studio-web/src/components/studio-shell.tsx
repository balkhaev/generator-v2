"use client";

import { env } from "@generator/env/web";
import {
	type AdminSnapshot,
	type ScenarioRecord,
	type ScenarioRunRecord,
	saveStudioShot,
	syncStudioRun,
} from "@generator/studio-client/client";
import WorkspaceShell, {
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import CommandSidebar from "@/components/command-sidebar";
import ComposeDialog from "@/components/compose/compose-dialog";
import MediaStrip from "@/components/media-strip";
import { ModeToggle } from "@/components/mode-toggle";
import PreviewSurface, {
	getMediaType,
	type StudioMediaAsset,
} from "@/components/preview-surface";
import type {
	ScenarioCardData,
	ScenarioRailStatus,
} from "@/components/scenario-card-data";
import { useRunAutoSync } from "@/components/use-run-auto-sync";
import UserMenu from "@/components/user-menu";
import { importGenerationToPerson } from "@/lib/persons-api";

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

function getScenarioStatus(runs: ScenarioRunRecord[]): ScenarioRailStatus {
	const latestRun = runs[0] ?? null;

	if (!latestRun) {
		return "draft";
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

function pickScenarioThumbnail(runs: ScenarioRunRecord[], scenarioId: string) {
	for (const run of runs) {
		if (run.scenarioId !== scenarioId) {
			continue;
		}

		const firstOutput = run.artifactUrls.find(
			(url) => getMediaType(url) === "image"
		);

		if (firstOutput) {
			return firstOutput;
		}
	}

	for (const run of runs) {
		if (run.scenarioId !== scenarioId) {
			continue;
		}

		if (run.inputImageUrl) {
			return run.inputImageUrl;
		}
	}

	return null;
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
			name: scenario.name,
			prompt: scenario.prompt,
			runCount: scenarioRuns.length,
			status: getScenarioStatus(scenarioRuns),
			thumbnailUrl: pickScenarioThumbnail(runs, scenario.id),
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

export default function StudioShell({
	initialSnapshot,
	sessionEmail,
	sessionName,
}: {
	initialSnapshot: AdminSnapshot;
	sessionEmail?: string | null;
	sessionName: string;
}) {
	const [snapshot, setSnapshot] = useState<AdminSnapshot>(initialSnapshot);
	const [isComposeOpen, setIsComposeOpen] = useState(false);
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
	const selectedMediaIndex = (() => {
		if (selectedScenarioAssets.length === 0) {
			return -1;
		}

		const directIndex = selectedScenarioAssets.findIndex(
			(asset) => asset.id === requestedAssetId
		);

		if (directIndex !== -1) {
			return directIndex;
		}

		return 0;
	})();
	const selectedMediaId =
		selectedMediaIndex === -1
			? null
			: selectedScenarioAssets[selectedMediaIndex].id;

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
		selectedMediaIndex === -1
			? null
			: selectedScenarioAssets[selectedMediaIndex];

	const [savingShotAssetId, setSavingShotAssetId] = useState<string | null>(
		null
	);

	const handleSaveShot = useCallback(
		async (asset: StudioMediaAsset) => {
			const run = snapshot.runs.find((entry) => entry.id === asset.runId);
			if (!run) {
				toast.error("Source run no longer available.");
				return;
			}
			setSavingShotAssetId(asset.id);
			try {
				if (run.inputPersonId) {
					if (!run.providerJobId) {
						toast.error("Run is not finished yet.");
						return;
					}
					await importGenerationToPerson(run.inputPersonId, {
						prompt: run.scenarioName,
						providerEndpointId: run.providerEndpointId ?? undefined,
						providerJobId: run.providerJobId,
						title: `${run.scenarioName} · ${asset.label}`,
						workflowKey: run.workflowKey,
					});
					toast.success("Saved to person.");
				} else {
					const result = await saveStudioShot({
						artifactKind: asset.mediaType,
						artifactUrl: asset.url,
						runId: asset.runId,
					});
					setSnapshot((current) => ({
						...current,
						shots: [result.data, ...current.shots],
					}));
					toast.success("Shot saved.");
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Unable to save shot."
				);
			} finally {
				setSavingShotAssetId(null);
			}
		},
		[snapshot.runs]
	);

	const handleSyncRun = useCallback(async (runId: string) => {
		try {
			const result = await syncStudioRun(runId);

			setSnapshot((current) => ({
				...current,
				runs: current.runs.map((run) => (run.id === runId ? result.data : run)),
			}));
		} catch {
			// silent: user-triggered syncs surface errors via toast in console
		}
	}, []);

	useRunAutoSync({
		enabled: true,
		onSync: handleSyncRun,
		runs: snapshot.runs,
	});

	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";
	const adminUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";

	function navigateToMedia(targetIndex: number) {
		if (targetIndex < 0 || targetIndex >= selectedScenarioAssets.length) {
			return;
		}

		router.replace(
			buildStudioHref(pathname, currentSearch, {
				assetId: selectedScenarioAssets[targetIndex].id,
				runId: requestedRunId,
			}),
			{ scroll: false }
		);
	}

	function handleCreateScenario() {
		setIsComposeOpen(true);
	}

	function handleScenarioCreated(nextSnapshot: AdminSnapshot) {
		setSnapshot(nextSnapshot);
		const created = nextSnapshot.scenarios[0];
		if (created) {
			router.push(
				buildStudioHref(pathname, currentSearch, {
					assetId: null,
					runId: null,
					scenarioId: created.id,
					tab: "launch",
				}),
				{ scroll: false }
			);
		}
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

	const activeRunCount = snapshot.runs.filter(
		(run) => run.status === "queued" || run.status === "running"
	).length;
	const succeededRunCount = snapshot.runs.filter(
		(run) => run.status === "succeeded"
	).length;

	return (
		<WorkspaceShell
			actions={
				<>
					<ModeToggle />
					<UserMenu email={sessionEmail} name={sessionName} />
				</>
			}
			context={
				<CommandSidebar
					getScenarioHref={getScenarioHref}
					onCreateScenario={handleCreateScenario}
					onSnapshotChange={setSnapshot}
					scenarioCards={scenarioCards}
					selectedScenarioId={selectedScenarioId}
					snapshot={snapshot}
				/>
			}
			contextWidth="wide"
			navigation={createWorkspaceNavigation("studio", {
				admin: adminUrl,
				persons: personsUrl,
				shots: "/shots",
				studio: "/",
			})}
			status={
				<>
					<WorkspaceStatus tone="info">
						{selectedScenarioCard?.workflowKey ?? "scenario"}
					</WorkspaceStatus>
					{activeRunCount > 0 ? (
						<WorkspaceStatus tone="warning">
							{activeRunCount} active
						</WorkspaceStatus>
					) : null}
					<WorkspaceStatus tone="success">
						{succeededRunCount} succeeded
					</WorkspaceStatus>
					<WorkspaceStatus tone="neutral">
						{selectedScenarioAssets.length} assets
					</WorkspaceStatus>
				</>
			}
			subtitle={
				selectedScenarioCard ? (
					<span className="flex flex-wrap items-center gap-2">
						<span>{selectedScenarioCard.duration}</span>
						<span aria-hidden="true">·</span>
						<span>{selectedScenarioCard.runCount} runs</span>
						{selectedScenarioCard.prompt ? (
							<>
								<span aria-hidden="true">·</span>
								<span className="line-clamp-1 max-w-[60ch] text-muted-foreground/80">
									{selectedScenarioCard.prompt}
								</span>
							</>
						) : null}
					</span>
				) : (
					`${snapshot.scenarios.length} scenarios ready to launch`
				)
			}
			title={selectedScenarioCard?.name ?? "Studio"}
			workspaceLabel="Studio"
		>
			<ComposeDialog
				onOpenChange={setIsComposeOpen}
				onScenarioCreated={handleScenarioCreated}
				open={isComposeOpen}
				snapshot={snapshot}
			/>
			<div className="flex h-full min-h-0 flex-col gap-2">
				<PreviewSurface
					asset={selectedMediaAsset}
					currentIndex={selectedMediaIndex}
					isSavingShot={
						selectedMediaAsset
							? savingShotAssetId === selectedMediaAsset.id
							: false
					}
					onNext={
						selectedMediaIndex < selectedScenarioAssets.length - 1
							? () => navigateToMedia(selectedMediaIndex + 1)
							: undefined
					}
					onPrevious={
						selectedMediaIndex > 0
							? () => navigateToMedia(selectedMediaIndex - 1)
							: undefined
					}
					onSaveShot={(asset) => {
						handleSaveShot(asset).catch(() => undefined);
					}}
					totalAssets={selectedScenarioAssets.length}
				/>
				<MediaStrip
					assets={selectedScenarioAssets}
					getHref={getMediaHref}
					selectedMediaId={selectedMediaId}
				/>
			</div>
		</WorkspaceShell>
	);
}
