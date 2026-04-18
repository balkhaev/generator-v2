"use client";

import type { AdminSettingsSnapshot } from "@generator/contracts/admin";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { cn } from "@generator/ui/lib/utils";
import { RefreshCw } from "lucide-react";

import { DatasetBuilderCard } from "@/components/settings/dataset-builder-card";
import { GeneratorRuntimeCard } from "@/components/settings/generator-runtime-card";
import { PersonsDefaultsCard } from "@/components/settings/persons-defaults-card";
import { TrainingProviderCard } from "@/components/settings/training-provider-card";
import { useAdminSettings } from "@/hooks/use-admin-settings";

export default function SettingsContent({
	initialSnapshot,
}: {
	initialSnapshot: AdminSettingsSnapshot | null;
}) {
	const { data, isFetching, refetch } = useAdminSettings(initialSnapshot);
	const snapshot = data ?? initialSnapshot;

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
				description="Inspect and tune runtime knobs for inference pipelines."
				eyebrow="Admin"
				title="Settings"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				{snapshot ? (
					<div className="grid gap-4 lg:grid-cols-2">
						<TrainingProviderCard
							runpod={snapshot.runpodTraining}
							settings={snapshot.trainingProvider}
						/>
						<DatasetBuilderCard settings={snapshot.datasetBuilder} />
						<PersonsDefaultsCard defaults={snapshot.personsDefaults} />
						<GeneratorRuntimeCard settings={snapshot.generatorRuntime} />
					</div>
				) : (
					<EmptyState
						hint="Make sure the admin gateway is reachable and you are signed in."
						message="Settings unavailable"
					/>
				)}
			</div>
		</div>
	);
}
