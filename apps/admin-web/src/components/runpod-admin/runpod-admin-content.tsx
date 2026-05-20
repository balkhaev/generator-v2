"use client";

import { PageHeader } from "@generator/ui/components/page-header";
import { cn } from "@generator/ui/lib/utils";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import {
	useAdminRunpodTemplates,
	useAdminRunpodVolumes,
	useScenarioRunpodBindings,
} from "@/hooks/use-admin-runpod";

import RunpodPodTemplatesSection from "./runpod-pod-templates-section";
import RunpodScenarioBindingsSection from "./runpod-scenario-bindings-section";
import RunpodVolumesSection from "./runpod-volumes-section";

type Tab = "templates" | "volumes" | "scenarios";

const TABS: Array<{ id: Tab; label: string; description: string }> = [
	{
		description:
			"RunPod pod templates and serverless endpoints registered with the generator runtime.",
		id: "templates",
		label: "Pod templates",
	},
	{
		description:
			"Network volumes (NFS) caching models and LoRAs across pod restarts.",
		id: "volumes",
		label: "Volumes",
	},
	{
		description:
			"Per-scenario binding to a specific pod template (overrides default RunPod routing).",
		id: "scenarios",
		label: "Scenarios",
	},
];

export default function RunpodAdminContent() {
	const [active, setActive] = useState<Tab>("templates");
	const volumesQuery = useAdminRunpodVolumes();
	const templatesQuery = useAdminRunpodTemplates();
	const scenariosQuery = useScenarioRunpodBindings();

	const refreshing =
		volumesQuery.isFetching ||
		templatesQuery.isFetching ||
		scenariosQuery.isFetching;

	const refreshAll = () => {
		volumesQuery.refetch();
		templatesQuery.refetch();
		scenariosQuery.refetch();
	};

	const activeTab = TABS.find((tab) => tab.id === active) ?? TABS[0];

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<button
						className="inline-flex items-center gap-2 rounded-md border border-foreground/10 bg-background px-2.5 py-1.5 text-xs transition hover:bg-muted/30 disabled:opacity-50"
						disabled={refreshing}
						onClick={refreshAll}
						type="button"
					>
						<RefreshCw
							className={cn("size-3", refreshing ? "animate-spin" : "")}
						/>
						Refresh
					</button>
				}
				description={activeTab?.description}
				eyebrow="RunPod runtime"
				title="RunPod administration"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<div className="grid gap-4">
					<TabBar active={active} onSelect={setActive} />
					{active === "templates" ? (
						<RunpodPodTemplatesSection
							templates={templatesQuery.data ?? []}
							volumes={volumesQuery.data ?? []}
						/>
					) : null}
					{active === "volumes" ? (
						<RunpodVolumesSection volumes={volumesQuery.data ?? []} />
					) : null}
					{active === "scenarios" ? (
						<RunpodScenarioBindingsSection
							bindings={scenariosQuery.data ?? []}
							templates={templatesQuery.data ?? []}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}

function TabBar({
	active,
	onSelect,
}: {
	active: Tab;
	onSelect: (tab: Tab) => void;
}) {
	return (
		<div className="flex gap-1 border-border/60 border-b">
			{TABS.map((tab) => (
				<button
					className={cn(
						"-mb-px border-transparent border-b-2 px-3 py-2 text-xs transition",
						active === tab.id
							? "border-foreground text-foreground"
							: "text-muted-foreground hover:text-foreground"
					)}
					key={tab.id}
					onClick={() => onSelect(tab.id)}
					type="button"
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}
