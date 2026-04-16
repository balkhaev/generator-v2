"use client";

import type { PersonLoraTrainingHistoryEntry } from "@generator/contracts/persons";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { Database } from "lucide-react";

import { trainingStatusTone } from "@/lib/status-tone";

function HistoryRow({ entry }: { entry: PersonLoraTrainingHistoryEntry }) {
	return (
		<div className="grid gap-1 rounded-md bg-muted/10 px-3 py-2 dark:bg-muted/5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge tone={trainingStatusTone(entry.status)}>
						{entry.status}
					</StatusBadge>
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

export default function TrainingHistory({
	entries,
}: {
	entries: PersonLoraTrainingHistoryEntry[];
}) {
	if (entries.length === 0) {
		return null;
	}

	return (
		<div className="grid gap-2">
			<div className="flex items-center gap-2 text-muted-foreground text-xs">
				<Database className="size-3.5" />
				<span>Recent training events</span>
			</div>
			<div className="grid gap-2">
				{entries.map((entry) => (
					<HistoryRow
						entry={entry}
						key={`${entry.at}-${entry.status}-${entry.phase}`}
					/>
				))}
			</div>
		</div>
	);
}
