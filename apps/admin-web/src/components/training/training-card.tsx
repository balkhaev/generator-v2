"use client";

import type { DashboardLoraTrainingSnapshot } from "@generator/contracts/admin";
import type { PersonLoraTrainingMeta } from "@generator/contracts/persons";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatDateTime, formatRelativeTime } from "@generator/ui/lib/format";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { trainingStatusTone } from "@/lib/status-tone";
import {
	formatDurationMs,
	getDerivedProgressPct,
	getDisplayTrainingStatus,
	getReferenceImageCount,
	getTrainingPhaseLabel,
	isActiveTrainingStatus,
} from "@/lib/training";

import TrainingHistory from "./training-history";
import TrainingProgress from "./training-progress";

function statusIcon(status: string | undefined) {
	if (!status) {
		return undefined;
	}
	if (status === "ready") {
		return CheckCircle2;
	}
	if (status === "failed") {
		return AlertTriangle;
	}
	if (isActiveTrainingStatus(status)) {
		return Loader2;
	}
	return undefined;
}

function MetaChips({
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

function ResourceLink({
	href,
	label,
	value,
}: {
	href: string;
	label: string;
	value: string;
}) {
	return (
		<a
			className="rounded-md border border-foreground/8 bg-muted/10 px-3 py-2 transition hover:bg-muted/20 dark:bg-muted/5 dark:hover:bg-muted/10"
			href={href}
			rel="noopener noreferrer"
			target="_blank"
		>
			<p className="font-medium text-foreground">{label}</p>
			<p className="truncate">{value}</p>
		</a>
	);
}

function Resources({
	item,
	training,
}: {
	item: DashboardLoraTrainingSnapshot;
	training: PersonLoraTrainingMeta | null;
}) {
	return (
		<div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
			{training?.debugCorrelationId ? (
				<div className="rounded-md border border-foreground/8 bg-muted/10 px-3 py-2 dark:bg-muted/5">
					<p className="font-medium text-foreground">Correlation</p>
					<p className="break-all">{training.debugCorrelationId}</p>
				</div>
			) : null}
			{item.datasetUrl ? (
				<ResourceLink
					href={item.datasetUrl}
					label="Dataset"
					value={item.datasetUrl}
				/>
			) : null}
			{item.loraUrl ? (
				<ResourceLink
					href={item.loraUrl}
					label="LoRA weights"
					value={item.loraUrl}
				/>
			) : null}
			<ResourceLink
				href={item.referencePhotoUrl}
				label="Reference photo"
				value={item.referencePhotoUrl}
			/>
		</div>
	);
}

function DebugDetails({
	training,
}: {
	training: PersonLoraTrainingMeta | null;
}) {
	if (!training) {
		return null;
	}
	return (
		<details className="group rounded-md border border-foreground/8 bg-background/60 px-3 py-3 dark:bg-background/30">
			<summary className="cursor-pointer list-none text-muted-foreground text-xs">
				<span className="group-open:hidden">Show raw training debug</span>
				<span className="hidden group-open:inline">
					Hide raw training debug
				</span>
			</summary>
			<pre className="mt-3 overflow-x-auto rounded-md bg-muted/15 p-3 font-mono text-[11px] text-foreground leading-relaxed dark:bg-muted/8">
				{JSON.stringify(training, null, 2)}
			</pre>
		</details>
	);
}

export default function TrainingCard({
	item,
}: {
	item: DashboardLoraTrainingSnapshot;
}) {
	const training = item.training;
	const hasLora = Boolean(item.loraUrl);
	const progressPct = getDerivedProgressPct(training, hasLora);
	const status = getDisplayTrainingStatus(training, hasLora);
	const referenceImageCount = getReferenceImageCount(training);
	const referenceImageTargetCount =
		typeof training?.referenceImageTargetCount === "number"
			? training.referenceImageTargetCount
			: null;
	const recentHistory = training?.history?.slice(-4).reverse() ?? [];
	const phaseLabel = getTrainingPhaseLabel(training, hasLora);
	const Icon = statusIcon(status);

	return (
		<article className="grid gap-4 rounded-xl border border-foreground/8 bg-background/40 px-4 py-4 dark:bg-background/20">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-medium text-sm">{item.personName}</h3>
						{status ? (
							<StatusBadge icon={Icon} tone={trainingStatusTone(status)}>
								{status}
							</StatusBadge>
						) : null}
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
			<MetaChips
				referenceImageCount={referenceImageCount}
				referenceImageTargetCount={referenceImageTargetCount}
				training={training}
			/>

			{training?.errorSummary ? (
				<p className="rounded-md border border-rose-500/15 bg-rose-500/5 px-3 py-2 text-rose-700 text-xs dark:bg-rose-500/8 dark:text-rose-300">
					{training.errorSummary}
				</p>
			) : null}

			<Resources item={item} training={training} />
			<TrainingHistory entries={recentHistory} />
			<DebugDetails training={training} />
		</article>
	);
}
