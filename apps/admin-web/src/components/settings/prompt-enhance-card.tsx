"use client";

import type {
	PromptEnhanceProviderName,
	PromptEnhanceSettingsSnapshot,
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
	grok: "Uses XAI_API_KEY on studio-api (grok-4-fast).",
	openrouter:
		"Uses OPENROUTER_API_KEY on studio-api. Pick any model slug below (stored in Redis).",
};

const PROVIDERS: PromptEnhanceProviderName[] = ["grok", "openrouter"];

interface PromptEnhanceCardProps {
	settings: PromptEnhanceSettingsSnapshot;
}

export function PromptEnhanceCard({ settings }: PromptEnhanceCardProps) {
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

	const errorText =
		mutation.error instanceof Error ? mutation.error.message : null;

	return (
		<SettingsCard
			action={
				mutation.isPending ? (
					<div className="inline-flex items-center gap-1 text-muted-foreground text-xs">
						<Loader2 className="size-3 animate-spin" />
						Saving…
					</div>
				) : null
			}
			description="Provider and OpenRouter model slug are stored in Redis. studio-api must have the matching API keys."
			title="Studio prompt enhancement"
		>
			<div className="grid gap-2">
				{PROVIDERS.map((name) => {
					const isActive = settings.provider === name;
					const disabled = mutation.isPending || isActive;
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
							onClick={() => mutation.mutate({ provider: name })}
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
								{configured ? null : (
									<p className="text-[10px] text-amber-700 dark:text-amber-400">
										Gateway env may be empty while studio-api still has the key
										— try enhance in Studio to verify.
									</p>
								)}
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
					hint="Fallback when Redis has no model (OPENROUTER_MODEL on studio-api)"
					label="Env default (studio)"
					value={settings.openRouterModelEnvDefault}
				/>
				<div className="flex flex-wrap items-end gap-2">
					<div className="grid min-w-0 flex-1 gap-1">
						<span className="text-[10px] text-muted-foreground">
							Active slug (Redis)
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
							mutation.isPending ||
							modelDraft.trim() === "" ||
							modelDraft.trim() === settings.openRouterModel
						}
						onClick={() =>
							mutation.mutate({ openRouterModel: modelDraft.trim() })
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
