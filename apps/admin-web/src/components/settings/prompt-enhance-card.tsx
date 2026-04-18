"use client";

import type {
	PromptEnhanceProviderName,
	PromptEnhanceSettingsSnapshot,
} from "@generator/contracts/admin";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Loader2 } from "lucide-react";

import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";
import { useUpdatePromptEnhanceProvider } from "@/hooks/use-prompt-enhance-provider";

const PROVIDER_LABELS: Record<PromptEnhanceProviderName, string> = {
	grok: "xAI Grok",
	openrouter: "OpenRouter",
};

const PROVIDER_DESCRIPTIONS: Record<PromptEnhanceProviderName, string> = {
	grok: "Uses XAI_API_KEY on studio-api (model grok-4-fast).",
	openrouter:
		"Uses OPENROUTER_API_KEY and OPENROUTER_MODEL on studio-api. OpenAI-compatible chat + vision.",
};

const PROVIDERS: PromptEnhanceProviderName[] = ["grok", "openrouter"];

interface PromptEnhanceCardProps {
	settings: PromptEnhanceSettingsSnapshot;
}

export function PromptEnhanceCard({ settings }: PromptEnhanceCardProps) {
	const mutation = useUpdatePromptEnhanceProvider();
	const errorText =
		mutation.error instanceof Error ? mutation.error.message : null;

	return (
		<SettingsCard
			action={
				mutation.isPending ? (
					<div className="inline-flex items-center gap-1 text-muted-foreground text-xs">
						<Loader2 className="size-3 animate-spin" />
						Switching…
					</div>
				) : null
			}
			description="Controls Studio «Enhance» and vision rewrite for scenarios. Selection is stored in Redis (same DB as training provider switch). API keys must be set on studio-api."
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
							onClick={() => mutation.mutate(name)}
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

			<div className="mt-4 grid gap-0">
				<div className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]">
					OpenRouter
				</div>
				<SettingsRow
					hint="OPENROUTER_MODEL on studio-api (and gateway for this readout)"
					label="Model slug"
					value={settings.openRouterModel}
				/>
			</div>
		</SettingsCard>
	);
}
