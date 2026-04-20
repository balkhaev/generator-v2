"use client";

import { Button } from "@generator/ui/components/button";
import { Checkbox } from "@generator/ui/components/checkbox";
import { SectionLabel } from "@generator/ui/components/section-label";
import { WorkspacePane } from "@generator/ui/components/workspace-shell";
import { DownloadCloud, Loader2, Search, Sparkles } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	type AdorelyImportResponse,
	runAdorelyImport,
} from "@/lib/persons-api";

function buildSkipReasonSummary(summary: AdorelyImportResponse["summary"]) {
	return summary.results
		.filter((result) => result.skipped)
		.reduce<Record<string, number>>((counts, result) => {
			const reason = result.skipReason ?? "unknown";
			counts[reason] = (counts[reason] ?? 0) + 1;
			return counts;
		}, {});
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-sm border border-foreground/6 bg-muted/20 px-2 py-1.5 dark:bg-muted/10">
			<div className="font-medium text-sm tabular-nums">{value}</div>
			<div className="text-[10px] text-muted-foreground uppercase tracking-wide">
				{label}
			</div>
		</div>
	);
}

function ImportIcon({
	isPending,
	startTraining,
}: {
	isPending: boolean;
	startTraining: boolean;
}) {
	if (isPending) {
		return <Loader2 className="size-3.5 animate-spin" />;
	}
	if (startTraining) {
		return <Sparkles className="size-3.5" />;
	}
	return <DownloadCloud className="size-3.5" />;
}

export function AdorelyImportPanel({
	onImported,
}: {
	onImported: () => Promise<unknown>;
}) {
	const [preview, setPreview] = useState<AdorelyImportResponse | null>(null);
	const [startTraining, setStartTraining] = useState(false);
	const [isPending, startTransition] = useTransition();
	const summary = preview?.summary;
	const skipReasons = useMemo(
		() => (summary ? buildSkipReasonSummary(summary) : {}),
		[summary]
	);
	const importDisabled = isPending || !summary || summary.imported === 0;

	function run(mode: "import" | "import-and-start-training" | "preview") {
		startTransition(async () => {
			try {
				const response = await runAdorelyImport({ mode });
				setPreview(response);
				if (mode === "preview") {
					toast.success(`Adorely preview: ${response.summary.imported} ready`);
					return;
				}
				await onImported();
				toast.success(
					startTraining
						? `Imported ${response.summary.imported}; queued ${response.summary.startedTraining}`
						: `Imported ${response.summary.imported}`
				);
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Adorely import failed"
				);
			}
		});
	}

	return (
		<WorkspacePane>
			<div className="grid gap-3 px-4 py-3">
				<div className="flex items-center justify-between gap-3">
					<SectionLabel>Adorely risk 2</SectionLabel>
					<span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
						R2
					</span>
				</div>

				<div className="grid grid-cols-3 gap-2">
					<SummaryMetric label="ready" value={summary?.imported ?? 0} />
					<SummaryMetric label="skipped" value={summary?.skipped ?? 0} />
					<SummaryMetric label="queued" value={summary?.startedTraining ?? 0} />
				</div>

				<div className="flex items-center gap-2 rounded-sm border border-foreground/6 bg-muted/15 px-2 py-2">
					<Checkbox
						checked={startTraining}
						id="adorely-start-training"
						onCheckedChange={(checked) => setStartTraining(checked === true)}
					/>
					<label
						className="cursor-pointer text-muted-foreground text-xs"
						htmlFor="adorely-start-training"
					>
						Start dataset prep
					</label>
				</div>

				<div className="grid grid-cols-2 gap-2">
					<Button
						disabled={isPending}
						onClick={() => run("preview")}
						size="sm"
						type="button"
						variant="outline"
					>
						{isPending ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Search className="size-3.5" />
						)}
						Preview
					</Button>
					<Button
						disabled={importDisabled}
						onClick={() =>
							run(startTraining ? "import-and-start-training" : "import")
						}
						size="sm"
						type="button"
					>
						<ImportIcon isPending={isPending} startTraining={startTraining} />
						Import
					</Button>
				</div>

				{summary ? (
					<div className="grid gap-2 text-xs">
						<div className="flex items-center justify-between text-muted-foreground">
							<span>{summary.total} scanned</span>
							<span>{summary.failed} failed</span>
						</div>
						{Object.entries(skipReasons).length > 0 ? (
							<div className="grid gap-1 text-muted-foreground/70">
								{Object.entries(skipReasons).map(([reason, count]) => (
									<div className="flex justify-between gap-3" key={reason}>
										<span className="truncate">{reason}</span>
										<span className="tabular-nums">{count}</span>
									</div>
								))}
							</div>
						) : null}
						<div className="grid gap-1">
							{summary.results
								.filter((result) => !result.skipped)
								.slice(0, 4)
								.map((result) => (
									<div
										className="flex justify-between gap-3 text-muted-foreground"
										key={result.companionId}
									>
										<span className="truncate">{result.name}</span>
										<span className="shrink-0 tabular-nums">
											{result.importedDatasetPhotoCount}/25
										</span>
									</div>
								))}
						</div>
					</div>
				) : null}
			</div>
		</WorkspacePane>
	);
}
