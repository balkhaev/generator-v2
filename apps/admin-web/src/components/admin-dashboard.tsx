import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { EmptyState } from "@generator/ui/components/empty-state";
import { SectionLabel } from "@generator/ui/components/section-label";
import { formatDateTime, formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { Boxes, Server, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import type {
	AdminDashboardSnapshot,
	DashboardRecentRun,
	DashboardScenarioSummary,
} from "@/lib/admin-dashboard";

const runStatusClasses: Record<DashboardRecentRun["status"], string> = {
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	running: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

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

function StatChip({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1 rounded-lg bg-muted/15 px-4 py-3 dark:bg-muted/8">
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className="font-medium text-lg tracking-tight">{value}</p>
		</div>
	);
}

function ScenarioRow({ scenario }: { scenario: DashboardScenarioSummary }) {
	return (
		<article className="grid gap-2 rounded-lg bg-muted/15 px-4 py-3 dark:bg-muted/8">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<div className="flex items-center gap-2">
						<Sparkles className="size-3.5 text-muted-foreground" />
						<h3 className="font-medium text-sm">{scenario.name}</h3>
					</div>
					<p className="text-muted-foreground text-xs">
						{scenario.workflowKey} · {scenario.runCount} runs
					</p>
				</div>
				{scenario.lastRunStatus ? (
					<StatusPill className={runStatusClasses[scenario.lastRunStatus]}>
						{scenario.lastRunStatus}
					</StatusPill>
				) : (
					<StatusPill className="bg-muted/20 text-muted-foreground">
						no runs
					</StatusPill>
				)}
			</div>
			<p className="text-muted-foreground text-xs">
				{scenario.lastRunAt
					? `Last run ${formatRelativeTime(scenario.lastRunAt)}`
					: "Never executed"}
			</p>
		</article>
	);
}

function RunRow({ run }: { run: DashboardRecentRun }) {
	return (
		<article
			className="grid gap-3 rounded-lg bg-muted/8 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_12rem] dark:bg-muted/5"
			key={run.id}
		>
			<div className="grid gap-2">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="grid gap-1">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="font-medium text-sm">{run.scenarioName}</h3>
							<StatusPill className={runStatusClasses[run.status]}>
								{run.status}
							</StatusPill>
						</div>
						<p className="text-muted-foreground text-xs">
							{run.workflowKey} · {run.inputLabel}
						</p>
					</div>
					<p className="text-muted-foreground text-xs">
						{formatDateTime(run.createdAt)}
					</p>
				</div>
				<div className="flex flex-wrap gap-1.5 text-xs">
					<span className="rounded-full bg-muted/15 px-2 py-0.5 text-muted-foreground dark:bg-muted/8">
						endpoint {run.providerEndpointId ?? "pending"}
					</span>
					<span className="rounded-full bg-muted/15 px-2 py-0.5 text-muted-foreground dark:bg-muted/8">
						job {run.providerJobId ?? "pending"}
					</span>
					<span className="rounded-full bg-muted/15 px-2 py-0.5 text-muted-foreground dark:bg-muted/8">
						{run.artifactCount} artifacts
					</span>
				</div>
				{run.errorSummary ? (
					<p className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
						{run.errorSummary}
					</p>
				) : null}
			</div>
			<div className="grid gap-2 rounded-lg bg-muted/10 px-3 py-3 text-xs dark:bg-muted/5">
				<div className="flex items-center gap-2 text-muted-foreground">
					<Server className="size-3.5" />
					<span>{formatRelativeTime(run.createdAt)}</span>
				</div>
				<div className="flex items-center gap-2 text-muted-foreground">
					<Boxes className="size-3.5" />
					<span>
						{run.primaryArtifactUrl ? "artifact ready" : "artifact pending"}
					</span>
				</div>
				<a
					className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
					href={run.primaryArtifactUrl ?? run.inputImageUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					Open asset
				</a>
			</div>
		</article>
	);
}

export default function AdminDashboard({
	snapshot,
}: {
	snapshot: AdminDashboardSnapshot;
}) {
	return (
		<section className="grid gap-6">
			{snapshot.notices.length > 0 ? (
				<Card>
					<CardContent className="pt-6">
						<div className="grid gap-2 rounded-lg bg-amber-500/8 px-4 py-4 text-muted-foreground text-xs dark:bg-amber-500/5">
							<SectionLabel>Data notices</SectionLabel>
							{snapshot.notices.map((notice) => (
								<p key={notice}>{notice}</p>
							))}
						</div>
					</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Scenario Library</CardTitle>
					<CardDescription>
						Latest scenarios with their last execution state.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{snapshot.scenarios.length === 0 ? (
						<EmptyState
							hint="No scenario records are available from the generator API."
							message="Scenarios unavailable"
						/>
					) : (
						snapshot.scenarios.map((scenario) => (
							<ScenarioRow key={scenario.id} scenario={scenario} />
						))
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Execution Stream</CardTitle>
					<CardDescription>
						The current queue, recent completions, and anything failing.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					<div className="grid gap-3 sm:grid-cols-4">
						<StatChip
							label="Queued"
							value={String(snapshot.runStatus.queued)}
						/>
						<StatChip
							label="Running"
							value={String(snapshot.runStatus.running)}
						/>
						<StatChip
							label="Succeeded"
							value={String(snapshot.runStatus.succeeded)}
						/>
						<StatChip
							label="Failed"
							value={String(snapshot.runStatus.failed)}
						/>
					</div>

					{snapshot.recentRuns.length === 0 ? (
						<EmptyState
							hint="The generator API did not return any recent runs."
							message="Runs unavailable"
						/>
					) : (
						snapshot.recentRuns.map((run) => <RunRow key={run.id} run={run} />)
					)}
				</CardContent>
			</Card>
		</section>
	);
}
