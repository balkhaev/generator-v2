"use client";

import { Button } from "@generator/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import { formatDateTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { Loader2, Upload } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
	type AssetReleaseGroup,
	type AssetReleasePreset,
	type AssetReleaseSnapshot,
	fetchAssetRelease,
	fetchAssetReleasePresets,
	fetchAssetReleases,
	provisionAssetReleasePreset,
	uploadAssetRelease,
	type VolumeDistributionJobSnapshot,
} from "@/lib/asset-releases-client";

const selectClassName =
	"flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

const groupOptions = [
	{ value: "workflows", label: "Workflows" },
	{ value: "models", label: "Models" },
	{ value: "loras", label: "Loras" },
	{ value: "vae", label: "VAE" },
	{ value: "checkpoints", label: "Checkpoints" },
] as const;

const terminalStatuses = new Set(["ready", "degraded", "failed"]);

const jobStatusClasses: Record<
	VolumeDistributionJobSnapshot["status"],
	string
> = {
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	syncing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	verifying: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
};

const releaseStatusTone: Record<AssetReleaseSnapshot["status"], string> = {
	degraded: "text-amber-600 dark:text-amber-400",
	distributing: "text-sky-600 dark:text-sky-400",
	failed: "text-rose-600 dark:text-rose-400",
	ready: "text-emerald-600 dark:text-emerald-400",
};

function formatBytes(value: number) {
	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(1)} KB`;
	}

	if (value < 1024 * 1024 * 1024) {
		return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	}

	return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StatusPill({
	children,
	className,
}: {
	children: ReactNode;
	className: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex rounded-full px-2 py-0.5 text-[11px]",
				className
			)}
		>
			{children}
		</span>
	);
}

export default function AssetReleaseConsole() {
	const [label, setLabel] = useState("");
	const [group, setGroup] = useState<AssetReleaseGroup>("workflows");
	const [files, setFiles] = useState<File[]>([]);
	const [releases, setReleases] = useState<AssetReleaseSnapshot[]>([]);
	const [presets, setPresets] = useState<AssetReleasePreset[]>([]);
	const [activeReleaseId, setActiveReleaseId] = useState<string | null>(null);
	const [uploadProgressPct, setUploadProgressPct] = useState(0);
	const [isUploading, setIsUploading] = useState(false);
	const [isProvisioningPresetId, setIsProvisioningPresetId] = useState<
		string | null
	>(null);
	const [isLoading, setIsLoading] = useState(true);

	const activeRelease = useMemo(
		() => releases.find((release) => release.id === activeReleaseId) ?? null,
		[activeReleaseId, releases]
	);
	const recentReleaseList = useMemo(() => {
		if (isLoading) {
			return <EmptyState message="Loading recent releases..." />;
		}

		if (releases.length === 0) {
			return <EmptyState message="No releases have been uploaded yet." />;
		}

		return releases.map((release) => (
			<button
				className="grid gap-2 rounded-lg bg-muted/15 px-4 py-3 text-left transition hover:bg-muted/25 dark:bg-muted/8 dark:hover:bg-muted/15"
				key={release.id}
				onClick={() => setActiveReleaseId(release.id)}
				type="button"
			>
				<div className="flex items-center justify-between gap-2">
					<p className="font-medium text-sm">{release.label}</p>
					<StatusPill
						className={cn(
							"border-border bg-muted",
							releaseStatusTone[release.status]
						)}
					>
						{release.status}
					</StatusPill>
				</div>
				<p className="text-muted-foreground text-xs">
					{release.group} · {release.filesTotal} files · {release.volumesReady}/
					{release.volumesTotal} ready
				</p>
			</button>
		));
	}, [isLoading, releases]);

	useEffect(() => {
		async function loadReleases() {
			try {
				const [nextReleases, nextPresets] = await Promise.all([
					fetchAssetReleases(),
					fetchAssetReleasePresets().catch(() => []),
				]);
				setReleases(nextReleases);
				setPresets(nextPresets);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Unable to load asset releases."
				);
			} finally {
				setIsLoading(false);
			}
		}

		loadReleases();
	}, []);

	useEffect(() => {
		if (!(activeReleaseId && activeRelease)) {
			return;
		}

		if (terminalStatuses.has(activeRelease.status)) {
			return;
		}

		const timer = window.setInterval(async () => {
			try {
				const release = await fetchAssetRelease(activeReleaseId);
				setReleases((current) => {
					const next = current.filter((item) => item.id !== release.id);
					return [release, ...next].sort((left, right) =>
						right.createdAt.localeCompare(left.createdAt)
					);
				});
			} catch {
				// Keep polling silent for MVP; the latest successful state stays visible.
			}
		}, 2000);

		return () => window.clearInterval(timer);
	}, [activeRelease, activeReleaseId]);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (files.length === 0) {
			toast.error("Select at least one file.");
			return;
		}

		setIsUploading(true);
		setUploadProgressPct(0);

		try {
			const release = await uploadAssetRelease({
				files,
				group,
				label: label.trim() || `${group} release ${new Date().toISOString()}`,
				onProgress: setUploadProgressPct,
			});

			setActiveReleaseId(release.id);
			setReleases((current) => [
				release,
				...current.filter((item) => item.id !== release.id),
			]);
			setFiles([]);
			setLabel("");
			toast.success("Release uploaded. Volume sync has started.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to create release."
			);
		} finally {
			setIsUploading(false);
		}
	}

	async function handleProvisionPreset(presetId: string) {
		setIsProvisioningPresetId(presetId);

		try {
			const result = await provisionAssetReleasePreset(presetId);
			setReleases((current) => {
				const next = [...current];
				for (const release of result.releases) {
					const withoutCurrent = next.filter((item) => item.id !== release.id);
					next.length = 0;
					next.push(...withoutCurrent, release);
				}

				return [...next].sort((left, right) =>
					right.createdAt.localeCompare(left.createdAt)
				);
			});
			setActiveReleaseId(result.releases[0]?.id ?? null);
			toast.success(`Provisioned preset: ${result.preset.name}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to provision preset."
			);
		} finally {
			setIsProvisioningPresetId(null);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>S3 release rollout</CardTitle>
				<CardDescription>
					Upload or provision a release, then track fan-out across volumes.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-6">
				<div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
					<form
						className="grid gap-4 rounded-lg bg-muted/10 px-4 py-4 dark:bg-muted/5"
						onSubmit={handleSubmit}
					>
						{presets.length > 0 ? (
							<div className="grid gap-3 rounded-lg bg-muted/15 px-4 py-4 dark:bg-muted/8">
								<div className="grid gap-1">
									<p className="font-medium text-sm">Preset bundles</p>
									<p className="text-muted-foreground text-xs">
										One-click rollout from a canonical source.
									</p>
								</div>
								{presets.map((preset) => (
									<div
										className="grid gap-2 rounded-lg bg-background/50 px-3 py-3 dark:bg-background/30"
										key={preset.id}
									>
										<div className="grid gap-1">
											<p className="font-medium text-xs">{preset.name}</p>
										</div>
										<p className="text-muted-foreground text-xs">
											{preset.description}
										</p>
										<p className="text-muted-foreground text-xs">
											Bundle:{" "}
											{preset.assets
												.map((asset) => `${asset.group}/${asset.fileName}`)
												.join(", ")}
										</p>
										<div className="flex items-center gap-2">
											<Button
												disabled={isProvisioningPresetId === preset.id}
												onClick={() => handleProvisionPreset(preset.id)}
												type="button"
												variant="outline"
											>
												{isProvisioningPresetId === preset.id ? (
													<Loader2 className="size-3.5 animate-spin" />
												) : (
													<Upload className="size-3.5" />
												)}
												Provision preset
											</Button>
											<a
												className="text-xs underline-offset-4 hover:underline"
												href={preset.sourceUrl}
												rel="noreferrer noopener"
												target="_blank"
											>
												Open source
											</a>
										</div>
									</div>
								))}
							</div>
						) : null}
						<div className="grid gap-2">
							<Label htmlFor="release-label">Release label</Label>
							<Input
								id="release-label"
								onChange={(event) => setLabel(event.target.value)}
								placeholder="workflow bundle 2026-04-04"
								value={label}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="release-group">Volume target</Label>
							<select
								className={selectClassName}
								id="release-group"
								onChange={(event) =>
									setGroup(event.target.value as AssetReleaseGroup)
								}
								value={group}
							>
								{groupOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<p className="text-muted-foreground text-xs">
								Writes into the canonical{" "}
								<code className="rounded bg-muted/20 px-1 py-0.5 dark:bg-muted/10">
									{group}/
								</code>{" "}
								lane.
							</p>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="release-files">Files</Label>
							<Input
								id="release-files"
								multiple
								onChange={(event) =>
									setFiles(Array.from(event.target.files ?? []))
								}
								type="file"
							/>
							<p className="text-muted-foreground text-xs">
								Selected {files.length} files,{" "}
								{formatBytes(
									files.reduce((total, file) => total + file.size, 0)
								)}
							</p>
						</div>
						{isUploading ? (
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs">
									<span className="text-muted-foreground">
										Upload to gateway
									</span>
									<span>{uploadProgressPct}%</span>
								</div>
								<div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
									<div
										className="h-full rounded-full bg-foreground transition-[width]"
										style={{ width: `${uploadProgressPct}%` }}
									/>
								</div>
							</div>
						) : null}
						<Button disabled={isUploading} type="submit">
							{isUploading ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Upload className="size-3.5" />
							)}
							Create release
						</Button>
					</form>

					<div className="grid gap-4">
						{activeRelease ? (
							<article className="grid gap-4 rounded-lg bg-muted/8 px-4 py-4 dark:bg-muted/5">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="grid gap-1">
										<div className="flex flex-wrap items-center gap-2">
											<h3 className="font-medium text-sm">
												{activeRelease.label}
											</h3>
											<StatusPill
												className={cn(
													"bg-muted",
													releaseStatusTone[activeRelease.status]
												)}
											>
												{activeRelease.status}
											</StatusPill>
										</div>
										<p className="text-muted-foreground text-xs">
											{activeRelease.group} · {activeRelease.filesTotal} files ·{" "}
											{formatBytes(activeRelease.bytesTotal)}
										</p>
									</div>
									<p className="text-muted-foreground text-xs">
										{formatDateTime(activeRelease.createdAt)}
									</p>
								</div>

								<div className="grid gap-2">
									<div className="flex items-center justify-between text-xs">
										<span className="text-muted-foreground">
											Overall rollout
										</span>
										<span>{activeRelease.progressPct}%</span>
									</div>
									<div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
										<div
											className="h-full rounded-full bg-foreground transition-[width]"
											style={{ width: `${activeRelease.progressPct}%` }}
										/>
									</div>
									<p className="text-muted-foreground text-xs">
										{activeRelease.volumesReady}/{activeRelease.volumesTotal}{" "}
										ready · {activeRelease.volumesFailed} failed
									</p>
								</div>

								<div className="grid gap-3 lg:grid-cols-2">
									{activeRelease.jobs.map((job) => (
										<div
											className="grid gap-2 rounded-lg bg-muted/15 px-3 py-3 dark:bg-muted/8"
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
												<StatusPill className={jobStatusClasses[job.status]}>
													{job.status}
												</StatusPill>
											</div>
											<div className="grid gap-2">
												<div className="flex items-center justify-between text-[11px]">
													<span className="text-muted-foreground">
														Progress
													</span>
													<span>{job.progressPct}%</span>
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
												{formatBytes(job.bytesSynced)}/
												{formatBytes(job.bytesTotal)}
											</p>
											{job.errorSummary ? (
												<p className="rounded-lg bg-rose-500/10 px-2 py-2 text-[11px] text-rose-600 dark:text-rose-400">
													{job.errorSummary}
												</p>
											) : null}
										</div>
									))}
								</div>
							</article>
						) : (
							<EmptyState
								hint="Upload a release to start S3 fan-out and volume sync tracking."
								message="No active rollout"
							/>
						)}

						<div className="grid gap-3">
							<SectionLabel>Recent releases</SectionLabel>
							{Array.isArray(recentReleaseList)
								? recentReleaseList.slice(0, 4)
								: recentReleaseList}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
