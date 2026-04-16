"use client";

import { EmptyState } from "@generator/ui/components/empty-state";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatBytes, formatDateTime } from "@generator/ui/lib/format";

import { useAssetRelease } from "@/hooks/use-asset-releases";
import type { AssetReleaseSnapshot } from "@/lib/asset-releases-client";
import { jobStatusTone, releaseStatusTone } from "@/lib/status-tone";

export default function ActiveRelease({
	fallback,
	releaseId,
}: {
	fallback: AssetReleaseSnapshot | null;
	releaseId: string | null;
}) {
	const { data } = useAssetRelease(releaseId);
	const release = data ?? fallback;

	if (!release) {
		return (
			<EmptyState
				hint="Upload a release to start S3 fan-out and volume sync tracking."
				message="No active rollout"
			/>
		);
	}

	return (
		<article className="grid gap-4 rounded-lg border border-foreground/8 bg-background/40 px-4 py-4 dark:bg-background/20">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-medium text-sm">{release.label}</h3>
						<StatusBadge tone={releaseStatusTone(release.status)}>
							{release.status}
						</StatusBadge>
					</div>
					<p className="text-muted-foreground text-xs">
						{release.group} · {release.filesTotal} files ·{" "}
						{formatBytes(release.bytesTotal)}
					</p>
				</div>
				<p className="text-muted-foreground text-xs">
					{formatDateTime(release.createdAt)}
				</p>
			</div>

			<div className="grid gap-2">
				<div className="flex items-center justify-between text-xs">
					<span className="text-muted-foreground">Overall rollout</span>
					<span className="tabular-nums">{release.progressPct}%</span>
				</div>
				<div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
					<div
						className="h-full rounded-full bg-foreground transition-[width]"
						style={{ width: `${release.progressPct}%` }}
					/>
				</div>
				<p className="text-muted-foreground text-xs">
					{release.volumesReady}/{release.volumesTotal} ready ·{" "}
					{release.volumesFailed} failed
				</p>
			</div>

			<div className="grid gap-3 lg:grid-cols-2">
				{release.jobs.map((job) => (
					<div
						className="grid gap-2 rounded-md border border-foreground/8 bg-muted/15 px-3 py-3 dark:bg-muted/8"
						key={job.id}
					>
						<div className="flex items-center justify-between gap-2">
							<div>
								<p className="font-medium text-xs">
									{job.volumeName ?? job.volumeId}
								</p>
								<p className="text-[11px] text-muted-foreground">
									{job.region ?? "unknown region"}
								</p>
							</div>
							<StatusBadge tone={jobStatusTone(job.status)}>
								{job.status}
							</StatusBadge>
						</div>
						<div className="grid gap-2">
							<div className="flex items-center justify-between text-[11px]">
								<span className="text-muted-foreground">Progress</span>
								<span className="tabular-nums">{job.progressPct}%</span>
							</div>
							<div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
								<div
									className="h-full rounded-full bg-foreground transition-[width]"
									style={{ width: `${job.progressPct}%` }}
								/>
							</div>
						</div>
						<p className="text-[11px] text-muted-foreground">
							{job.filesSynced}/{job.filesTotal} files ·{" "}
							{formatBytes(job.bytesSynced)}/{formatBytes(job.bytesTotal)}
						</p>
						{job.errorSummary ? (
							<p className="rounded-md border border-rose-500/15 bg-rose-500/5 px-2 py-2 text-[11px] text-rose-600 dark:bg-rose-500/8 dark:text-rose-400">
								{job.errorSummary}
							</p>
						) : null}
					</div>
				))}
			</div>
		</article>
	);
}
