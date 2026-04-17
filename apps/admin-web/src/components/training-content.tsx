"use client";

import type { AdminDashboardSnapshot } from "@generator/contracts/admin";
import type { PersonLoraTrainingStatus } from "@generator/contracts/persons";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { StatCard } from "@generator/ui/components/stat-card";
import { cn } from "@generator/ui/lib/utils";
import {
	CheckCircle2,
	GraduationCap,
	Loader2,
	RefreshCw,
	Search,
} from "lucide-react";
import { useMemo, useState } from "react";

import TrainingCard from "@/components/training/training-card";
import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import {
	getDisplayTrainingStatus,
	isActiveTrainingStatus,
} from "@/lib/training";

type TrainingStatusFilter = PersonLoraTrainingStatus | "ready" | "all";

const FILTERS: { value: TrainingStatusFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "queued", label: "Queued" },
	{ value: "generating", label: "Generating" },
	{ value: "training", label: "Training" },
	{ value: "publishing", label: "Publishing" },
	{ value: "ready", label: "Ready" },
	{ value: "failed", label: "Failed" },
];

const selectClassName =
	"h-8 rounded-md border border-foreground/10 bg-background px-2 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

export default function TrainingContent({
	initialSnapshot,
}: {
	initialSnapshot: AdminDashboardSnapshot;
}) {
	const { data, isFetching, refetch } = useAdminDashboard(initialSnapshot);
	const snapshot = data ?? initialSnapshot;
	const [filter, setFilter] = useState<TrainingStatusFilter>("all");
	const [search, setSearch] = useState("");

	const stats = useMemo(() => {
		let active = 0;
		let ready = 0;
		let failed = 0;
		for (const item of snapshot.loraTrainings) {
			const status = getDisplayTrainingStatus(
				item.training,
				Boolean(item.loraUrl)
			);
			if (status === "ready") {
				ready++;
			} else if (status === "failed") {
				failed++;
			} else if (isActiveTrainingStatus(status)) {
				active++;
			}
		}
		return {
			active,
			failed,
			ready,
			total: snapshot.loraTrainings.length,
		};
	}, [snapshot.loraTrainings]);

	const filteredItems = useMemo(() => {
		const term = search.trim().toLowerCase();
		return snapshot.loraTrainings.filter((item) => {
			if (filter !== "all") {
				const status = getDisplayTrainingStatus(
					item.training,
					Boolean(item.loraUrl)
				);
				if (status !== filter) {
					return false;
				}
			}
			if (term) {
				const hay = `${item.personName} ${item.personSlug}`.toLowerCase();
				if (!hay.includes(term)) {
					return false;
				}
			}
			return true;
		});
	}, [snapshot.loraTrainings, filter, search]);

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<div className="flex items-center gap-2">
						<div className="relative">
							<Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
							<input
								className="h-8 w-44 rounded-md border border-foreground/10 bg-background pr-2 pl-7 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search by person"
								value={search}
							/>
						</div>
						<select
							aria-label="Filter by status"
							className={selectClassName}
							onChange={(event) =>
								setFilter(event.target.value as TrainingStatusFilter)
							}
							value={filter}
						>
							{FILTERS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
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
				description={`${filteredItems.length} of ${stats.total} training jobs.`}
				eyebrow="LoRA training"
				title="Training"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<div className="grid gap-4">
					<div className="grid gap-3 sm:grid-cols-3">
						<StatCard
							icon={Loader2}
							label="Active"
							tone="warning"
							value={stats.active}
						/>
						<StatCard
							icon={CheckCircle2}
							label="Ready"
							tone="success"
							value={stats.ready}
						/>
						<StatCard
							icon={GraduationCap}
							label="Failed"
							tone={stats.failed > 0 ? "danger" : "default"}
							value={stats.failed}
						/>
					</div>

					{filteredItems.length === 0 ? (
						<EmptyState
							hint={
								snapshot.loraTrainings.length === 0
									? "Training runs and debug metadata will appear here once persons start training."
									: "Try changing filters or search."
							}
							message={
								snapshot.loraTrainings.length === 0
									? "No LoRA activity yet"
									: "No matches"
							}
						/>
					) : (
						<div className="grid gap-3">
							{filteredItems.map((item) => (
								<TrainingCard item={item} key={item.personId} />
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
