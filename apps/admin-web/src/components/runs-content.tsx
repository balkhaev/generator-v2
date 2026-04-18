"use client";

import type {
	AdminDashboardSnapshot,
	DashboardRecentRun,
} from "@generator/contracts/admin";
import type { RunStatus } from "@generator/contracts/generator";
import {
	DataList,
	type DataListColumn,
} from "@generator/ui/components/data-list";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import { runStatusTone } from "@/lib/status-tone";

const STATUS_OPTIONS: { value: RunStatus | ""; label: string }[] = [
	{ value: "", label: "All statuses" },
	{ value: "queued", label: "Queued" },
	{ value: "running", label: "Running" },
	{ value: "succeeded", label: "Succeeded" },
	{ value: "failed", label: "Failed" },
];

const selectClassName =
	"h-8 rounded-md border border-foreground/10 bg-background px-2 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

export default function RunsContent({
	initialSnapshot,
}: {
	initialSnapshot: AdminDashboardSnapshot;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const statusParam = (searchParams?.get("status") ?? "") as RunStatus | "";
	const workflowParam = searchParams?.get("workflow") ?? "";

	const { data, isFetching, refetch } = useAdminDashboard(initialSnapshot);
	const snapshot = data ?? initialSnapshot;

	const workflows = useMemo(() => {
		const set = new Set<string>();
		for (const run of snapshot.recentRuns) {
			set.add(run.workflowKey);
		}
		return Array.from(set).sort();
	}, [snapshot.recentRuns]);

	const filteredRuns = useMemo(() => {
		return snapshot.recentRuns.filter((run) => {
			if (statusParam && run.status !== statusParam) {
				return false;
			}
			if (workflowParam && run.workflowKey !== workflowParam) {
				return false;
			}
			return true;
		});
	}, [snapshot.recentRuns, statusParam, workflowParam]);

	const updateParam = useCallback(
		(key: string, value: string) => {
			const params = new URLSearchParams(searchParams?.toString() ?? "");
			if (value) {
				params.set(key, value);
			} else {
				params.delete(key);
			}
			const search = params.toString();
			router.replace(`${pathname}${search ? `?${search}` : ""}` as Route);
		},
		[pathname, router, searchParams]
	);

	const columns: DataListColumn<DashboardRecentRun>[] = [
		{
			key: "scenario",
			header: "Scenario",
			width: "minmax(0,1.4fr)",
			render: (run) => (
				<div className="grid gap-0.5">
					<span className="truncate font-medium text-sm">
						{run.scenarioName}
					</span>
					<span className="truncate text-[11px] text-muted-foreground">
						{run.workflowKey} · {run.inputLabel}
					</span>
				</div>
			),
		},
		{
			key: "status",
			header: "Status",
			width: "8rem",
			render: (run) => (
				<StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
			),
		},
		{
			key: "endpoint",
			header: "Endpoint",
			width: "10rem",
			hideOnMobile: true,
			render: (run) => (
				<span className="truncate text-[11px] text-muted-foreground">
					{run.providerEndpointId ?? "pending"}
				</span>
			),
		},
		{
			key: "artifacts",
			header: "Artifacts",
			width: "6rem",
			align: "right",
			hideOnMobile: true,
			render: (run) => (
				<span className="text-[11px] text-muted-foreground tabular-nums">
					{run.artifactCount}
				</span>
			),
		},
		{
			key: "createdAt",
			header: "When",
			width: "8rem",
			align: "right",
			render: (run) => (
				<span className="text-[11px] text-muted-foreground">
					{formatRelativeTime(run.createdAt)}
				</span>
			),
		},
		{
			key: "details",
			header: "Details",
			width: "5rem",
			align: "right",
			render: (run) => (
				<Link
					className="text-[11px] text-sky-600 underline-offset-4 hover:underline dark:text-sky-400"
					href={`/runs/${run.id}` as Route}
				>
					Debug
				</Link>
			),
		},
		{
			key: "asset",
			header: "Asset",
			width: "5rem",
			align: "right",
			render: (run) => (
				<a
					className="inline-flex items-center gap-1 text-[11px] text-foreground underline-offset-4 hover:underline"
					href={run.primaryArtifactUrl ?? run.inputImageUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					Open <ExternalLink className="size-3" />
				</a>
			),
		},
	];

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<div className="flex items-center gap-2">
						<select
							aria-label="Filter by status"
							className={selectClassName}
							onChange={(event) => updateParam("status", event.target.value)}
							value={statusParam}
						>
							{STATUS_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<select
							aria-label="Filter by workflow"
							className={selectClassName}
							onChange={(event) => updateParam("workflow", event.target.value)}
							value={workflowParam}
						>
							<option value="">All workflows</option>
							{workflows.map((workflow) => (
								<option key={workflow} value={workflow}>
									{workflow}
								</option>
							))}
						</select>
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
					</div>
				}
				description={`${filteredRuns.length} of ${snapshot.recentRuns.length} runs in the recent window.`}
				eyebrow="Execution stream"
				title="Runs"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<div className="grid gap-3">
					<DataList
						columns={columns}
						emptyState={
							<EmptyState
								hint="Try clearing filters or wait for the next refresh."
								message="No runs match these filters."
							/>
						}
						getRowKey={(run) => run.id}
						rows={filteredRuns}
					/>

					{filteredRuns.some((run) => run.errorSummary) ? (
						<div className="grid gap-2">
							<p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]">
								Recent errors
							</p>
							{filteredRuns
								.filter((run) => run.errorSummary)
								.slice(0, 5)
								.map((run) => (
									<div
										className="rounded-md border border-rose-500/15 bg-rose-500/5 px-3 py-2 text-rose-700 text-xs dark:bg-rose-500/8 dark:text-rose-300"
										key={`error-${run.id}`}
									>
										<span className="font-medium">{run.scenarioName}</span> ·{" "}
										{run.errorSummary}
									</div>
								))}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
