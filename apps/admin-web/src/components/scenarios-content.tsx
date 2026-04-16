"use client";

import type {
	AdminDashboardSnapshot,
	DashboardScenarioSummary,
} from "@generator/contracts/admin";
import {
	DataList,
	type DataListColumn,
} from "@generator/ui/components/data-list";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import { runStatusTone } from "@/lib/status-tone";

export default function ScenariosContent({
	initialSnapshot,
	studioUrl,
}: {
	initialSnapshot: AdminDashboardSnapshot;
	studioUrl: string;
}) {
	const { data, isFetching, refetch } = useAdminDashboard(initialSnapshot);
	const snapshot = data ?? initialSnapshot;
	const [search, setSearch] = useState("");

	const filteredScenarios = useMemo(() => {
		if (!search.trim()) {
			return snapshot.scenarios;
		}
		const term = search.toLowerCase();
		return snapshot.scenarios.filter(
			(scenario) =>
				scenario.name.toLowerCase().includes(term) ||
				scenario.workflowKey.toLowerCase().includes(term)
		);
	}, [snapshot.scenarios, search]);

	const columns: DataListColumn<DashboardScenarioSummary>[] = [
		{
			key: "name",
			header: "Scenario",
			width: "minmax(0,1.4fr)",
			render: (scenario) => (
				<div className="grid gap-0.5">
					<span className="truncate font-medium text-sm">{scenario.name}</span>
					<span className="truncate text-[11px] text-muted-foreground">
						{scenario.workflowKey}
					</span>
				</div>
			),
		},
		{
			key: "runs",
			header: "Runs",
			width: "5rem",
			align: "right",
			render: (scenario) => (
				<span className="text-[11px] text-muted-foreground tabular-nums">
					{scenario.runCount}
				</span>
			),
		},
		{
			key: "lastStatus",
			header: "Last status",
			width: "8rem",
			render: (scenario) =>
				scenario.lastRunStatus ? (
					<StatusBadge tone={runStatusTone(scenario.lastRunStatus)}>
						{scenario.lastRunStatus}
					</StatusBadge>
				) : (
					<StatusBadge tone="muted">draft</StatusBadge>
				),
		},
		{
			key: "lastRun",
			header: "Last run",
			width: "8rem",
			align: "right",
			hideOnMobile: true,
			render: (scenario) => (
				<span className="text-[11px] text-muted-foreground">
					{scenario.lastRunAt
						? formatRelativeTime(scenario.lastRunAt)
						: "never"}
				</span>
			),
		},
		{
			key: "open",
			header: "Open",
			width: "6rem",
			align: "right",
			render: (scenario) => (
				<a
					className="inline-flex items-center gap-1 text-[11px] text-foreground underline-offset-4 hover:underline"
					href={`${studioUrl}?scenario=${encodeURIComponent(scenario.id)}`}
					rel="noopener noreferrer"
					target="_blank"
				>
					Studio <ExternalLink className="size-3" />
				</a>
			),
		},
	];

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<div className="flex items-center gap-2">
						<div className="relative">
							<Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
							<input
								className="h-8 w-48 rounded-md border border-foreground/10 bg-background pr-2 pl-7 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search scenarios"
								value={search}
							/>
						</div>
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
				description={`${filteredScenarios.length} of ${snapshot.scenarios.length} scenarios. Open any to launch in Studio.`}
				eyebrow="Scenario library"
				title="Scenarios"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<DataList
					columns={columns}
					emptyState={
						<EmptyState
							hint="The generator API did not return any scenarios."
							message="No scenarios"
						/>
					}
					getRowKey={(scenario) => scenario.id}
					rows={filteredScenarios}
				/>
			</div>
		</div>
	);
}
