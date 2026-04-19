"use client";

import type { DatasetBuilderSettings } from "@generator/contracts/admin";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Loader2 } from "lucide-react";

import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";
import { useUpdateDatasetBuilderModel } from "@/hooks/use-dataset-builder";

interface DatasetBuilderCardProps {
	settings: DatasetBuilderSettings;
}

export function DatasetBuilderCard({ settings }: DatasetBuilderCardProps) {
	const mutation = useUpdateDatasetBuilderModel();
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
			description={settings.note}
			title="LoRA dataset builder"
		>
			<div className="grid gap-2">
				{settings.availableModels.map((option) => {
					const isActive = settings.model === option.id;
					const disabled = mutation.isPending || isActive;
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
							key={option.id}
							onClick={() => mutation.mutate({ model: option.id })}
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
									<span className="font-medium text-sm">{option.label}</span>
									<span className="font-mono text-[10px] text-muted-foreground">
										{option.id}
									</span>
									{isActive ? (
										<span className="rounded bg-foreground px-1.5 py-0.5 font-mono text-[9px] text-background uppercase tracking-wider">
											Active
										</span>
									) : null}
									<span
										className={cn(
											"rounded px-1.5 py-0.5 font-mono text-[9px]",
											option.supportsNegativePrompt
												? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
												: "bg-muted text-muted-foreground"
										)}
									>
										{option.supportsNegativePrompt
											? "negative prompt"
											: "no negative prompt"}
									</span>
								</div>
								<div className="text-muted-foreground text-xs">
									{option.description}
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

			<div className="mt-4 grid gap-1">
				<SettingsRow label="Poll interval" value={`${settings.pollMs} ms`} />
				<SettingsRow
					label="Submit timeout"
					value={`${Math.round(settings.timeoutMs / 60_000)} min`}
				/>
				<SettingsRow
					hint="Используется только моделями, поддерживающими negative_prompt."
					label="Negative prompt"
					value={
						<details className="cursor-pointer">
							<summary className="text-muted-foreground text-xs hover:text-foreground">
								Show
							</summary>
							<div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
								{settings.negativePromptPreview}
							</div>
						</details>
					}
				/>
			</div>
		</SettingsCard>
	);
}
