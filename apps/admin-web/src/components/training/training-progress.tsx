"use client";

import type { PersonLoraTrainingStatus } from "@generator/contracts/persons";
import { cn } from "@generator/ui/lib/utils";

function getProgressBarClass(
	status: PersonLoraTrainingStatus | "ready" | undefined
) {
	if (status === "failed") {
		return "bg-rose-500/80";
	}
	if (status === "ready") {
		return "bg-emerald-500/80";
	}
	return "bg-[linear-gradient(90deg,rgba(14,165,233,0.65),rgba(139,92,246,0.8),rgba(245,158,11,0.8))]";
}

export default function TrainingProgress({
	phaseLabel,
	progressPct,
	provider,
	status,
}: {
	phaseLabel: string;
	progressPct: number;
	provider: string | undefined;
	status: PersonLoraTrainingStatus | "ready" | undefined;
}) {
	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-3 text-[11px]">
				<span className="text-muted-foreground">{phaseLabel}</span>
				<span className="font-medium tabular-nums">{progressPct}%</span>
			</div>
			<div className="h-2 overflow-hidden rounded-full bg-muted/30 dark:bg-muted/15">
				<div
					className={cn(
						"h-full rounded-full transition-[width] duration-500",
						getProgressBarClass(status)
					)}
					style={{ width: `${progressPct}%` }}
				/>
			</div>
			{provider ? (
				<p className="text-[11px] text-muted-foreground">{provider}</p>
			) : null}
		</div>
	);
}
