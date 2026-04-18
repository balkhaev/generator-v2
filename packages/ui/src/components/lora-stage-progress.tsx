import type {
	PersonLoraStageItem,
	PersonLoraStageState,
} from "@generator/contracts/persons";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Loader2 } from "lucide-react";

function getLoraStageBlockClass(state: PersonLoraStageState) {
	if (state === "failed") {
		return "border-rose-500/30 text-rose-700 dark:text-rose-300";
	}
	if (state === "done") {
		return "border-emerald-500/30 text-emerald-700 dark:text-emerald-300";
	}
	if (state === "active") {
		return "border-violet-500/30 text-violet-700 dark:text-violet-300";
	}
	return "border-border/50 text-muted-foreground";
}

function getLoraStageFillClass(state: PersonLoraStageState) {
	if (state === "failed") {
		return "bg-rose-500/15";
	}
	if (state === "done") {
		return "bg-emerald-500/15";
	}
	if (state === "active") {
		return "bg-violet-500/20";
	}
	return "bg-transparent";
}

function getLoraStageWidth(stage: PersonLoraStageItem) {
	if (stage.state === "done") {
		return 100;
	}
	if (stage.state === "active" || stage.state === "failed") {
		return stage.progressPct;
	}
	return 0;
}

function LoraStageBlock({ stage }: { stage: PersonLoraStageItem }) {
	const isActive = stage.state === "active";
	const isDone = stage.state === "done";
	const isFailed = stage.state === "failed";
	const widthPct = getLoraStageWidth(stage);
	const showPercent = isActive || isFailed;

	return (
		<div
			className={cn(
				"relative overflow-hidden rounded-lg border bg-background/40 transition-colors",
				getLoraStageBlockClass(stage.state)
			)}
		>
			<div
				aria-hidden
				className={cn(
					"absolute inset-y-0 left-0 transition-[width] duration-700 ease-out",
					getLoraStageFillClass(stage.state)
				)}
				style={{ width: `${widthPct}%` }}
			/>
			<div className="relative grid gap-0.5 px-2.5 py-2 text-[11px]">
				<div className="flex items-center justify-between gap-2">
					<span className="flex items-center gap-1 font-medium leading-none">
						{isActive ? <Loader2 className="size-3 animate-spin" /> : null}
						{isDone ? <CheckCircle2 className="size-3" /> : null}
						{stage.label}
					</span>
					{showPercent ? (
						<span className="font-medium tabular-nums leading-none">
							{Math.round(widthPct)}%
						</span>
					) : null}
				</div>
				{stage.detail ? (
					<span className="truncate opacity-80">{stage.detail}</span>
				) : null}
			</div>
		</div>
	);
}

/**
 * Renders the four LoRA training stages (Queued → Dataset → Training → Ready)
 * as horizontal blocks. Each block is its own progress bar that fills from the
 * left as the stage advances; in the "Training" block the detail line shows
 * the estimated `~X/Y steps` derived in `getPersonLoraTrainingStages`.
 */
export function LoraStageProgress({
	className,
	stages,
}: {
	className?: string;
	stages: PersonLoraStageItem[];
}) {
	return (
		<div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}>
			{stages.map((stage) => (
				<LoraStageBlock key={stage.id} stage={stage} />
			))}
		</div>
	);
}
