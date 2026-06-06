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
import { SearchInput } from "@generator/ui/components/search-input";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { RefreshButton } from "@generator/ui/components/toolbar";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { ExternalLink } from "lucide-react";
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
						<SearchInput
							className="w-48"
							onValueChange={setSearch}
							placeholder="Search scenarios"
							value={search}
						/>
						<RefreshButton
							isRefreshing={isFetching}
							onRefresh={() => refetch()}
						/>
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
