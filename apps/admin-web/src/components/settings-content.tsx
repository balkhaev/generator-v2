"use client";

import type { AdminSettingsSnapshot } from "@generator/contracts/admin";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { cn } from "@generator/ui/lib/utils";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { DatasetBuilderCard } from "@/components/settings/dataset-builder-card";
import { IntegrationsCard } from "@/components/settings/integrations-card";
import { PromptEnhanceCard } from "@/components/settings/prompt-enhance-card";
import { TrainingProviderCard } from "@/components/settings/training-provider-card";
import { useAdminSettings } from "@/hooks/use-admin-settings";

/**
 * Sectioned settings shell. We deliberately skipped the read-only diagnostic
 * cards (worker health, persons defaults, generator runtime) — they don't
 * have controls and made the page feel like an env dump. Their values now
 * surface inside the cards that actually do something with them (worker
 * health appears as a banner inside training, runpod runtime is part of the
 * training card).
 */
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
					<div className="mx-auto grid w-full max-w-6xl gap-8">
						<SettingsSection
							description="Encrypted credentials shared between admin-api and consumer services. Updates propagate within ~10s via Redis pub/sub invalidation."
							title="Integrations"
						>
							<IntegrationsCard />
						</SettingsSection>

						<SettingsSection
							description="Each surface picks its own LLM independently — Studio can run on Qwen for fast rewrites while Persons stays on Grok for tighter persona prompts."
							title="Prompt enhancement"
						>
							<div className="grid gap-4 lg:grid-cols-2">
								<PromptEnhanceCard
									settings={snapshot.promptEnhance.studio}
									target="studio"
								/>
								<PromptEnhanceCard
									settings={snapshot.promptEnhance.persons}
									target="persons"
								/>
							</div>
						</SettingsSection>

						<SettingsSection
							description="LoRA training pipeline: provider selection, RunPod runtime, and the editor model that builds the dataset."
							title="Training"
						>
							<div className="grid gap-4 lg:grid-cols-2">
								<TrainingProviderCard
									runpod={snapshot.runpodTraining}
									settings={snapshot.trainingProvider}
									workerHealth={snapshot.workerHealth}
								/>
								<DatasetBuilderCard settings={snapshot.datasetBuilder} />
							</div>
						</SettingsSection>
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

function SettingsSection({
	children,
	description,
	title,
}: {
	children: ReactNode;
	description?: string;
	title: string;
}) {
	return (
		<section className="grid gap-3">
			<header className="grid gap-1">
				<h2 className="font-medium text-foreground text-sm tracking-tight">
					{title}
				</h2>
				{description ? (
					<p className="max-w-3xl text-muted-foreground text-xs leading-relaxed">
						{description}
					</p>
				) : null}
			</header>
			{children}
		</section>
	);
}
