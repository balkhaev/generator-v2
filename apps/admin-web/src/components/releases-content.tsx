"use client";

import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { SectionLabel } from "@generator/ui/components/section-label";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { cn } from "@generator/ui/lib/utils";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import ActiveRelease from "@/components/releases/active-release";
import PresetList from "@/components/releases/preset-list";
import ReleaseForm from "@/components/releases/release-form";
import { useAssetReleases } from "@/hooks/use-asset-releases";
import { releaseStatusTone } from "@/lib/status-tone";

export default function ReleasesContent() {
	const { data: releases = [], isFetching, refetch } = useAssetReleases(8);
	const [activeReleaseId, setActiveReleaseId] = useState<string | null>(null);

	const activeRelease = useMemo(
		() =>
			releases.find((release) => release.id === activeReleaseId) ??
			releases[0] ??
			null,
		[activeReleaseId, releases]
	);

	const recentReleases = releases.slice(0, 6);

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<button
						className="inline-flex items-center gap-2 rounded-md border border-foreground/10 bg-background px-2.5 py-1.5 text-xs transition hover:bg-muted/30 disabled:opacity-50"
						disabled={isFetching}
						onClick={() => refetch()}
						type="button"
					>
						<RefreshCw
							className={cn("size-3", isFetching ? "animate-spin" : "")}
						/>
						Refresh
					</button>
				}
				description="Upload bundles or provision presets, then track fan-out across volumes."
				eyebrow="S3 release rollout"
				title="Releases"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
					<div className="grid gap-4">
						<PresetList
							onProvisioned={(provisioned) => {
								if (provisioned[0]) {
									setActiveReleaseId(provisioned[0].id);
								}
								refetch();
							}}
						/>
						<ReleaseForm
							onCreated={(release) => {
								setActiveReleaseId(release.id);
								refetch();
							}}
						/>
					</div>

					<div className="grid gap-4">
						<ActiveRelease
							fallback={activeRelease}
							releaseId={activeRelease?.id ?? null}
						/>

						<div className="grid gap-2">
							<SectionLabel>Recent releases</SectionLabel>
							{recentReleases.length === 0 ? (
								<EmptyState message="No releases have been uploaded yet." />
							) : (
								<div className="grid gap-2">
									{recentReleases.map((release) => (
										<button
											className={cn(
												"grid gap-1 rounded-md border border-transparent px-3 py-2 text-left transition",
												release.id === activeRelease?.id
													? "border-foreground/15 bg-muted/30"
													: "bg-muted/15 hover:bg-muted/25 dark:bg-muted/8"
											)}
											key={release.id}
											onClick={() => setActiveReleaseId(release.id)}
											type="button"
										>
											<div className="flex items-center justify-between gap-2">
												<p className="truncate font-medium text-sm">
													{release.label}
												</p>
												<StatusBadge tone={releaseStatusTone(release.status)}>
													{release.status}
												</StatusBadge>
											</div>
											<p className="truncate text-[11px] text-muted-foreground">
												{release.group} · {release.filesTotal} files ·{" "}
												{release.volumesReady}/{release.volumesTotal} ready
											</p>
										</button>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
