"use client";

import type { AdminDashboardSnapshot } from "@generator/contracts/admin";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { SectionLabel } from "@generator/ui/components/section-label";
import { StatCard } from "@generator/ui/components/stat-card";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	GraduationCap,
	Loader2,
	RefreshCw,
	Sparkles,
	Tags,
	Workflow,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import { runStatusTone, trainingStatusTone } from "@/lib/status-tone";

function getActiveLoraTrainingCount(snapshot: AdminDashboardSnapshot) {
	return snapshot.loraTrainings.filter((item) => {
		const status = item.training?.status;
		return (
			status === "queued" ||
			status === "generating" ||
			status === "training" ||
			status === "publishing"
		);
	}).length;
}

export default function OverviewContent({
	initialSnapshot,
	personsUrl,
	studioUrl,
}: {
	initialSnapshot: AdminDashboardSnapshot;
	personsUrl: string;
	studioUrl: string;
}) {
	const { data, isFetching, refetch } = useAdminDashboard(initialSnapshot);
	const snapshot = data ?? initialSnapshot;
	const activeTrainings = getActiveLoraTrainingCount(snapshot);
	const recentRuns = snapshot.recentRuns.slice(0, 5);
	const recentScenarios = snapshot.scenarios.slice(0, 4);
	const recentTrainings = snapshot.loraTrainings.slice(0, 3);

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
				description={`Updated ${formatRelativeTime(snapshot.snapshotAt)}.`}
				eyebrow="Overview"
				title="Control room"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<div className="grid gap-4">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard
							hint="Awaiting a worker"
							icon={Loader2}
							label="Queued"
							tone="info"
							value={snapshot.runStatus.queued}
						/>
						<StatCard
							hint="Currently executing"
							icon={Workflow}
							label="Running"
							tone="warning"
							value={snapshot.runStatus.running}
						/>
						<StatCard
							hint="Completed (last 24h)"
							icon={CheckCircle2}
							label="Succeeded"
							tone="success"
							value={snapshot.runStatus.succeeded}
						/>
						<StatCard
							hint="Need attention"
							icon={AlertTriangle}
							label="Failed"
							tone={snapshot.runStatus.failed > 0 ? "danger" : "default"}
							value={snapshot.runStatus.failed}
						/>
					</div>

					{snapshot.notices.length > 0 ? (
						<div className="grid gap-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-amber-700 text-xs dark:bg-amber-500/8 dark:text-amber-300">
							<SectionLabel>Notices</SectionLabel>
							{snapshot.notices.map((notice) => (
								<p key={notice}>{notice}</p>
							))}
						</div>
					) : null}

					<div className="grid gap-4 lg:grid-cols-3">
						<section className="grid gap-2 rounded-lg border border-foreground/8 bg-background/40 p-4 dark:bg-background/20">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Workflow className="size-3.5 text-muted-foreground" />
									<SectionLabel>Recent runs</SectionLabel>
								</div>
								<Link
									className="text-[11px] text-muted-foreground underline-offset-4 hover:underline"
									href={"/runs" as Route}
								>
									View all
								</Link>
							</div>
							{recentRuns.length === 0 ? (
								<EmptyState message="No runs yet" />
							) : (
								<ul className="grid gap-1.5">
									{recentRuns.map((run) => (
										<li key={run.id}>
											<Link
												className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-muted/30"
												href={`/runs?status=${run.status}` as Route}
											>
												<span className="grid min-w-0 gap-0.5">
													<span className="truncate text-sm">
														{run.scenarioName}
													</span>
													<span className="truncate text-[11px] text-muted-foreground">
														{run.workflowKey} ·{" "}
														{formatRelativeTime(run.createdAt)}
													</span>
												</span>
												<StatusBadge tone={runStatusTone(run.status)}>
													{run.status}
												</StatusBadge>
											</Link>
										</li>
									))}
								</ul>
							)}
						</section>

						<section className="grid gap-2 rounded-lg border border-foreground/8 bg-background/40 p-4 dark:bg-background/20">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<GraduationCap className="size-3.5 text-muted-foreground" />
									<SectionLabel>
										Active training ({activeTrainings})
									</SectionLabel>
								</div>
								<Link
									className="text-[11px] text-muted-foreground underline-offset-4 hover:underline"
									href={"/training" as Route}
								>
									View all
								</Link>
							</div>
							{recentTrainings.length === 0 ? (
								<EmptyState message="No training yet" />
							) : (
								<ul className="grid gap-1.5">
									{recentTrainings.map((item) => {
										const status =
											item.training?.status ??
											(item.loraUrl ? "ready" : undefined);
										return (
											<li
												className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5"
												key={item.personId}
											>
												<span className="grid min-w-0 gap-0.5">
													<span className="truncate text-sm">
														{item.personName}
													</span>
													<span className="truncate text-[11px] text-muted-foreground">
														{item.training?.phase ??
															(status === "ready" ? "ready" : "no phase")}
													</span>
												</span>
												{status ? (
													<StatusBadge tone={trainingStatusTone(status)}>
														{status}
													</StatusBadge>
												) : null}
											</li>
										);
									})}
								</ul>
							)}
						</section>

						<section className="grid gap-2 rounded-lg border border-foreground/8 bg-background/40 p-4 dark:bg-background/20">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Sparkles className="size-3.5 text-muted-foreground" />
									<SectionLabel>Recent scenarios</SectionLabel>
								</div>
								<Link
									className="text-[11px] text-muted-foreground underline-offset-4 hover:underline"
									href={"/scenarios" as Route}
								>
									View all
								</Link>
							</div>
							{recentScenarios.length === 0 ? (
								<EmptyState message="No scenarios yet" />
							) : (
								<ul className="grid gap-1.5">
									{recentScenarios.map((scenario) => (
										<li key={scenario.id}>
											<a
												className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-muted/30"
												href={`${studioUrl}?scenario=${encodeURIComponent(scenario.id)}`}
												rel="noopener noreferrer"
												target="_blank"
											>
												<span className="grid min-w-0 gap-0.5">
													<span className="truncate text-sm">
														{scenario.name}
													</span>
													<span className="truncate text-[11px] text-muted-foreground">
														{scenario.workflowKey} · {scenario.runCount} runs
													</span>
												</span>
												{scenario.lastRunStatus ? (
													<StatusBadge
														tone={runStatusTone(scenario.lastRunStatus)}
													>
														{scenario.lastRunStatus}
													</StatusBadge>
												) : (
													<StatusBadge tone="muted">draft</StatusBadge>
												)}
											</a>
										</li>
									))}
								</ul>
							)}
						</section>
					</div>

					<div className="grid gap-3 sm:grid-cols-3">
						<Link
							className="flex items-center gap-3 rounded-lg border border-foreground/8 bg-muted/15 px-3 py-2.5 text-sm transition hover:bg-muted/25 dark:bg-muted/8"
							href={"/loras" as Route}
						>
							<Tags className="size-3.5 text-muted-foreground" />
							<span>Open LoRA registry</span>
						</Link>
						<a
							className="flex items-center gap-3 rounded-lg border border-foreground/8 bg-muted/15 px-3 py-2.5 text-sm transition hover:bg-muted/25 dark:bg-muted/8"
							href={studioUrl}
							rel="noopener noreferrer"
							target="_blank"
						>
							<Sparkles className="size-3.5 text-muted-foreground" />
							<span>Open Studio</span>
						</a>
						<a
							className="flex items-center gap-3 rounded-lg border border-foreground/8 bg-muted/15 px-3 py-2.5 text-sm transition hover:bg-muted/25 dark:bg-muted/8"
							href={personsUrl}
							rel="noopener noreferrer"
							target="_blank"
						>
							<GraduationCap className="size-3.5 text-muted-foreground" />
							<span>Open Persons</span>
						</a>
					</div>
				</div>
			</div>
		</div>
	);
}
