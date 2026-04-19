"use client";

import type {
	PromptEnhanceProviderName,
	PromptEnhanceSettingsSnapshot,
	PromptEnhanceTarget,
} from "@generator/contracts/admin";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";
import { useOpenRouterModels } from "@/hooks/use-openrouter-models";
import { useUpdatePromptEnhanceProvider } from "@/hooks/use-prompt-enhance-provider";

const PROVIDER_LABELS: Record<PromptEnhanceProviderName, string> = {
	grok: "xAI Grok",
	openrouter: "OpenRouter",
};

const PROVIDER_DESCRIPTIONS: Record<PromptEnhanceProviderName, string> = {
	grok: "Uses XAI_API_KEY (grok-4-fast) on the consumer service.",
	openrouter:
		"Uses OPENROUTER_API_KEY on the consumer service. Pick any model slug below.",
};

const TARGET_TITLES: Record<PromptEnhanceTarget, string> = {
	persons: "Persons prompt enhancement",
	studio: "Studio prompt enhancement",
};

const TARGET_SUBTITLES: Record<PromptEnhanceTarget, string> = {
	persons:
		"Used by the persons service when expanding a brief into 4 persona variants and during refine. Independent from studio so each surface can pick its own LLM.",
	studio:
		"Used by /enhance-prompt in studio. Independent from persons so each surface can pick its own LLM.",
};

const PROVIDERS: PromptEnhanceProviderName[] = ["grok", "openrouter"];

interface PromptEnhanceCardProps {
	settings: PromptEnhanceSettingsSnapshot;
	target: PromptEnhanceTarget;
}

export function PromptEnhanceCard({
	settings,
	target,
}: PromptEnhanceCardProps) {
	const mutation = useUpdatePromptEnhanceProvider();
	const [catalogRequested, setCatalogRequested] = useState(false);
	const [modelDraft, setModelDraft] = useState(settings.openRouterModel);
	const [modelFilter, setModelFilter] = useState("");

	const modelsQuery = useOpenRouterModels({ enabled: catalogRequested });

	useEffect(() => {
		setModelDraft(settings.openRouterModel);
	}, [settings.openRouterModel]);

	const filteredModels = useMemo(() => {
		const list = modelsQuery.data ?? [];
		const q = modelFilter.trim().toLowerCase();
		if (!q) {
			return list.slice(0, 200);
		}
		return list
			.filter(
				(m) =>
					m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
			)
			.slice(0, 200);
	}, [modelsQuery.data, modelFilter]);

	// Pending state must be scoped to THIS target — both PromptEnhanceCard
	// instances share one mutation hook, so we filter on `variables.target`.
	const isPendingForTarget =
		mutation.isPending && mutation.variables?.target === target;
	const errorText =
		mutation.error instanceof Error && mutation.variables?.target === target
			? mutation.error.message
			: null;

	return (
		<SettingsCard
			action={
				isPendingForTarget ? (
					<div className="inline-flex items-center gap-1 text-muted-foreground text-xs">
						<Loader2 className="size-3 animate-spin" />
						Saving…
					</div>
				) : null
			}
			description={TARGET_SUBTITLES[target]}
			title={TARGET_TITLES[target]}
		>
			<div className="grid gap-2">
				{PROVIDERS.map((name) => {
					const isActive = settings.provider === name;
					const disabled = isPendingForTarget || isActive;
					const configured =
						name === "grok"
							? settings.grokConfigured
							: settings.openRouterConfigured;

					return (
						<button
							className={cn(
								"grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-2.5 text-left transition",
								isActive
									? "border-foreground/40 bg-foreground/5"
									: "border-foreground/10 hover:bg-foreground/4",
								disabled && !isActive ? "cursor-not-allowed opacity-60" : ""
							)}
							disabled={disabled}
							key={name}
							onClick={() => mutation.mutate({ provider: name, target })}
							type="button"
						>
							<div className="mt-0.5">
								{isActive ? (
									<CheckCircle2 className="size-4 text-foreground" />
								) : (
									<div className="size-4 rounded-full border border-foreground/30" />
								)}
							</div>
							<div className="grid gap-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium text-sm">
										{PROVIDER_LABELS[name]}
									</span>
									{isActive ? (
										<span className="rounded bg-foreground px-1.5 py-0.5 font-mono text-[9px] text-background uppercase tracking-wider">
											Active
										</span>
									) : null}
									<span
										className={cn(
											"rounded px-1.5 py-0.5 font-mono text-[9px]",
											configured
												? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
												: "bg-muted text-muted-foreground"
										)}
									>
										{configured ? "key (gateway)" : "no key (gateway)"}
									</span>
								</div>
								<div className="text-muted-foreground text-xs">
									{PROVIDER_DESCRIPTIONS[name]}
								</div>
							</div>
						</button>
					);
				})}
			</div>

			{errorText ? (
				<div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
					{errorText}
				</div>
			) : null}

			<div className="mt-4 grid gap-2">
				<div className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]">
					OpenRouter model
				</div>
				<SettingsRow
					hint="Fallback when runtime-config has no value (OPENROUTER_MODEL on the consumer service)"
					label="Env default"
					value={settings.openRouterModelEnvDefault}
				/>
				<div className="flex flex-wrap items-end gap-2">
					<div className="grid min-w-0 flex-1 gap-1">
						<span className="text-[10px] text-muted-foreground">
							Active slug
						</span>
						<Input
							className="h-8 font-mono text-xs"
							onChange={(e) => setModelDraft(e.target.value)}
							placeholder="openai/gpt-4o-mini"
							value={modelDraft}
						/>
					</div>
					<Button
						className="h-8 shrink-0"
						disabled={
							isPendingForTarget ||
							modelDraft.trim() === "" ||
							modelDraft.trim() === settings.openRouterModel
						}
						onClick={() =>
							mutation.mutate({
								openRouterModel: modelDraft.trim(),
								target,
							})
						}
						size="sm"
						type="button"
						variant="secondary"
					>
						Save model
					</Button>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						className="h-8 gap-1"
						onClick={() => {
							if (catalogRequested) {
								modelsQuery.refetch().catch(() => {
									// Errors surface via modelsQuery.isError
								});
							} else {
								setCatalogRequested(true);
							}
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						{modelsQuery.isFetching ? (
							<Loader2 className="size-3 animate-spin" />
						) : (
							<RefreshCw className="size-3" />
						)}
						Load catalog
					</Button>
					{modelsQuery.isError ? (
						<span className="text-destructive text-xs">
							{modelsQuery.error instanceof Error
								? modelsQuery.error.message
								: "Failed to load models"}
						</span>
					) : null}
				</div>
				{catalogRequested && modelsQuery.data && modelsQuery.data.length > 0 ? (
					<div className="grid gap-1">
						<Input
							className="h-8 text-xs"
							onChange={(e) => setModelFilter(e.target.value)}
							placeholder="Filter catalog…"
							value={modelFilter}
						/>
						<select
							aria-label="OpenRouter models from catalog"
							className="max-h-40 min-h-32 w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
							onChange={(e) => setModelDraft(e.target.value)}
							size={Math.min(12, Math.max(4, filteredModels.length + 1))}
							value={
								filteredModels.some((m) => m.id === modelDraft)
									? modelDraft
									: ""
							}
						>
							<option value="">— pick from catalog —</option>
							{filteredModels.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name} — {m.id}
								</option>
							))}
						</select>
						<p className="text-[10px] text-muted-foreground">
							{filteredModels.length} models shown
							{modelFilter.trim() ? " (filtered)" : ""}. Pick a row, then «Save
							model».
						</p>
					</div>
				) : null}
			</div>
		</SettingsCard>
	);
}
