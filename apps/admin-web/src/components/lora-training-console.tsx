import type {
	PersonLoraTrainingHistoryEntry,
	PersonLoraTrainingMeta,
	PersonLoraTrainingStatus,
} from "@generator/contracts/persons";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { EmptyState } from "@generator/ui/components/empty-state";
import { formatDateTime, formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { AlertTriangle, CheckCircle2, Database, Loader2 } from "lucide-react";

import type { DashboardLoraTrainingSnapshot } from "@/lib/admin-dashboard";

const trainingStatusTone: Record<PersonLoraTrainingStatus, string> = {
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	generating: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	publishing: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	training: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

function clampProgressPct(value: number) {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function isActiveStatus(status: PersonLoraTrainingStatus | undefined) {
	return (
		status === "queued" ||
		status === "generating" ||
		status === "training" ||
		status === "publishing"
	);
}

function getDerivedProgressPct(training: PersonLoraTrainingMeta | null) {
	if (typeof training?.progressPct === "number") {
		return clampProgressPct(training.progressPct);
	}

	switch (training?.status) {
		case "queued":
			return 2;
		case "generating":
			return 30;
		case "training":
			return 76;
		case "publishing":
			return 92;
		case "ready":
			return 100;
		case "failed":
			return 100;
		default:
			return 0;
	}
}

function getReferenceImageCount(training: PersonLoraTrainingMeta | null) {
	if (typeof training?.referenceImageCount === "number") {
		return training.referenceImageCount;
	}
	return training?.referenceImageUrls?.length ?? 0;
}

function formatDurationMs(value: number | null | undefined) {
	if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
		return null;
	}

	if (value < 1000) {
		return `${value} ms`;
	}

	const totalSeconds = Math.round(value / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function HistoryRow({ entry }: { entry: PersonLoraTrainingHistoryEntry }) {
	return (
		<div className="grid gap-1 rounded-lg bg-muted/10 px-3 py-2 dark:bg-muted/5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span
						className={cn(
							"inline-flex rounded-full px-2 py-0.5 text-[11px]",
							trainingStatusTone[entry.status]
						)}
					>
						{entry.status}
					</span>
					{entry.phase ? (
						<span className="text-[11px] text-muted-foreground">
							{entry.phase}
						</span>
					) : null}
				</div>
				<span className="text-[11px] text-muted-foreground">
					{formatRelativeTime(entry.at)}
				</span>
			</div>
			<div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
				{entry.progressPct === null ? null : <span>{entry.progressPct}%</span>}
				{entry.referenceImageCount === null ? null : (
					<span>refs {entry.referenceImageCount}</span>
				)}
				{entry.providerStatus ? <span>{entry.providerStatus}</span> : null}
				{entry.providerJobId ? <span>job {entry.providerJobId}</span> : null}
			</div>
			{entry.errorSummary ? (
				<p className="text-[11px] text-rose-600 dark:text-rose-400">
					{entry.errorSummary}
				</p>
			) : null}
		</div>
	);
}

function getStatusIcon(status: PersonLoraTrainingStatus | "ready" | undefined) {
	if (!status) {
		return null;
	}
	if (isActiveStatus(status)) {
		return <Loader2 className="size-3 animate-spin" />;
	}
	if (status === "ready") {
		return <CheckCircle2 className="size-3" />;
	}
	if (status === "failed") {
		return <AlertTriangle className="size-3" />;
	}
	return null;
}

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

function TrainingStatusBadge({
	status,
}: {
	status: PersonLoraTrainingStatus | "ready" | undefined;
}) {
	if (!status) {
		return null;
	}

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
				trainingStatusTone[status]
			)}
		>
			{getStatusIcon(status)}
			{status}
		</span>
	);
}

function TrainingProgress({
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
				<span className="font-medium">{progressPct}%</span>
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

function TrainingMetaChips({
	referenceImageCount,
	referenceImageTargetCount,
	training,
}: {
	referenceImageCount: number;
	referenceImageTargetCount: number | null;
	training: PersonLoraTrainingMeta | null;
}) {
	const elapsed = formatDurationMs(training?.trainingElapsedMs);

	return (
		<div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
			{referenceImageCount > 0 ? (
				<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
					refs{" "}
					{referenceImageTargetCount
						? `${referenceImageCount}/${referenceImageTargetCount}`
						: referenceImageCount}
				</span>
			) : null}
			{training?.trainingSteps ? (
				<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
					steps {training.trainingSteps}
				</span>
			) : null}
			{training?.providerStatus ? (
				<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
					provider {training.providerStatus}
				</span>
			) : null}
			{training?.providerJobId ? (
				<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
					job {training.providerJobId}
				</span>
			) : null}
			{training?.providerRequestId ? (
				<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
					request {training.providerRequestId}
				</span>
			) : null}
			{training?.uploadMethod ? (
				<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
					upload {training.uploadMethod}
				</span>
			) : null}
			{elapsed ? (
				<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
					elapsed {elapsed}
				</span>
			) : null}
		</div>
	);
}

function TrainingResources({
	item,
	training,
}: {
	item: DashboardLoraTrainingSnapshot;
	training: PersonLoraTrainingMeta | null;
}) {
	return (
		<div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
			{training?.debugCorrelationId ? (
				<div className="rounded-lg bg-muted/10 px-3 py-2 dark:bg-muted/5">
					<p className="font-medium text-foreground">Correlation</p>
					<p className="break-all">{training.debugCorrelationId}</p>
				</div>
			) : null}
			{item.datasetUrl ? (
				<a
					className="rounded-lg bg-muted/10 px-3 py-2 transition hover:bg-muted/20 dark:bg-muted/5 dark:hover:bg-muted/10"
					href={item.datasetUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					<p className="font-medium text-foreground">Dataset</p>
					<p className="truncate">{item.datasetUrl}</p>
				</a>
			) : null}
			{item.loraUrl ? (
				<a
					className="rounded-lg bg-muted/10 px-3 py-2 transition hover:bg-muted/20 dark:bg-muted/5 dark:hover:bg-muted/10"
					href={item.loraUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					<p className="font-medium text-foreground">LoRA weights</p>
					<p className="truncate">{item.loraUrl}</p>
				</a>
			) : null}
			<a
				className="rounded-lg bg-muted/10 px-3 py-2 transition hover:bg-muted/20 dark:bg-muted/5 dark:hover:bg-muted/10"
				href={item.referencePhotoUrl}
				rel="noopener noreferrer"
				target="_blank"
			>
				<p className="font-medium text-foreground">Reference photo</p>
				<p className="truncate">{item.referencePhotoUrl}</p>
			</a>
		</div>
	);
}

function TrainingDebugDetails({
	training,
}: {
	training: PersonLoraTrainingMeta | null;
}) {
	if (!training) {
		return null;
	}

	return (
		<details className="group rounded-lg border border-border/40 bg-background/60 px-3 py-3 dark:bg-background/30">
			<summary className="cursor-pointer list-none text-muted-foreground text-xs">
				<span className="group-open:hidden">Show raw training debug</span>
				<span className="hidden group-open:inline">
					Hide raw training debug
				</span>
			</summary>
			<pre className="mt-3 overflow-x-auto rounded-lg bg-muted/15 p-3 font-mono text-[11px] text-foreground leading-relaxed dark:bg-muted/8">
				{JSON.stringify(training, null, 2)}
			</pre>
		</details>
	);
}

function TrainingCard({ item }: { item: DashboardLoraTrainingSnapshot }) {
	const training = item.training;
	const progressPct = getDerivedProgressPct(training);
	const status = training?.status ?? (item.loraUrl ? "ready" : undefined);
	const referenceImageCount = getReferenceImageCount(training);
	const referenceImageTargetCount =
		typeof training?.referenceImageTargetCount === "number"
			? training.referenceImageTargetCount
			: null;
	const recentHistory = training?.history?.slice(-4).reverse() ?? [];
	const phaseLabel = training?.phase ?? "No active phase";

	return (
		<article className="grid gap-4 rounded-xl border border-border/50 bg-muted/10 px-4 py-4 dark:bg-muted/5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-medium text-sm">{item.personName}</h3>
						<TrainingStatusBadge status={status} />
					</div>
					<p className="text-muted-foreground text-xs">
						{item.personSlug}
						{training?.triggerWord ? ` · trigger ${training.triggerWord}` : ""}
						{training?.provider ? ` · ${training.provider}` : ""}
					</p>
				</div>
				<div className="grid justify-items-end gap-1 text-right text-[11px] text-muted-foreground">
					<span>{formatRelativeTime(item.updatedAt)}</span>
					<span>{formatDateTime(item.updatedAt)}</span>
				</div>
			</div>

			<TrainingProgress
				phaseLabel={phaseLabel}
				progressPct={progressPct}
				provider={training?.provider ?? undefined}
				status={status}
			/>
			<TrainingMetaChips
				referenceImageCount={referenceImageCount}
				referenceImageTargetCount={referenceImageTargetCount}
				training={training}
			/>

			{training?.errorSummary ? (
				<p className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
					{training.errorSummary}
				</p>
			) : null}

			<TrainingResources item={item} training={training} />

			{recentHistory.length > 0 ? (
				<div className="grid gap-2">
					<div className="flex items-center gap-2 text-muted-foreground text-xs">
						<Database className="size-3.5" />
						<span>Recent training events</span>
					</div>
					<div className="grid gap-2">
						{recentHistory.map((entry) => (
							<HistoryRow
								entry={entry}
								key={`${entry.at}-${entry.status}-${entry.phase}`}
							/>
						))}
					</div>
				</div>
			) : null}

			<TrainingDebugDetails training={training} />
		</article>
	);
}

export default function LoraTrainingConsole({
	items,
}: {
	items: DashboardLoraTrainingSnapshot[];
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>LoRA Training</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-3">
				{items.length === 0 ? (
					<EmptyState
						hint="Training runs and debug metadata will appear here once persons start training."
						message="No LoRA activity yet"
					/>
				) : (
					items.map((item) => <TrainingCard item={item} key={item.personId} />)
				)}
			</CardContent>
		</Card>
	);
}
