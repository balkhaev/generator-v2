"use client";

import type { AdminDashboardSnapshot } from "@generator/contracts/admin";
import type { PersonLoraTrainingStatus } from "@generator/contracts/persons";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { SearchInput } from "@generator/ui/components/search-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@generator/ui/components/select";
import { StatCard } from "@generator/ui/components/stat-card";
import { RefreshButton } from "@generator/ui/components/toolbar";
import { CheckCircle2, GraduationCap, Loader2 } from "lucide-react";
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
						<SearchInput
							className="w-44"
							onValueChange={setSearch}
							placeholder="Search by person"
							value={search}
						/>
						<Select
							items={FILTERS}
							onValueChange={(value) =>
								setFilter((value ?? "all") as TrainingStatusFilter)
							}
							value={filter}
						>
							<SelectTrigger aria-label="Filter by status" className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{FILTERS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<RefreshButton
							isRefreshing={isFetching}
							onRefresh={() => refetch()}
						/>
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
