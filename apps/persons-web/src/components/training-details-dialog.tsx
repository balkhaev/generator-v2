"use client";

import type {
	PersonLoraTrainingHistoryEntry,
	PersonLoraTrainingMeta,
	PersonLoraTrainingStatus,
} from "@generator/contracts/persons";
import { Button } from "@generator/ui/components/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@generator/ui/components/dialog";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { ArrowUpRight, Copy } from "lucide-react";
import { toast } from "sonner";

type EffectiveStatus = PersonLoraTrainingStatus | "ready";

interface MachineSummary {
	costPerHr?: number;
	dataCenterId?: string;
	gpuCount?: number;
	gpuDisplayName?: string;
	gpuTypeId?: string;
	location?: string;
	podHostId?: string;
	secureCloud?: boolean;
}

interface DebugSummary {
	baseModel?: string;
	gpuTypeIds?: string[];
	imageName?: string;
	machine?: MachineSummary;
	podId?: string;
	podLogUrl?: string;
	runpodPodConsoleUrl?: string;
	tqdmStep?: number;
	tqdmTotal?: number;
	trainingModel?: string;
}

function pickString(
	raw: Record<string, unknown>,
	key: string
): string | undefined {
	const value = raw[key];
	return typeof value === "string" ? value : undefined;
}

function pickNumber(
	raw: Record<string, unknown>,
	key: string
): number | undefined {
	const value = raw[key];
	return typeof value === "number" ? value : undefined;
}

function pickBool(
	raw: Record<string, unknown>,
	key: string
): boolean | undefined {
	const value = raw[key];
	return typeof value === "boolean" ? value : undefined;
}

function readMachine(raw: Record<string, unknown>): MachineSummary | undefined {
	const node = raw.machine;
	if (!node || typeof node !== "object") {
		return;
	}
	const machineRaw = node as Record<string, unknown>;
	return {
		costPerHr: pickNumber(machineRaw, "costPerHr"),
		dataCenterId: pickString(machineRaw, "dataCenterId"),
		gpuCount: pickNumber(machineRaw, "gpuCount"),
		gpuDisplayName: pickString(machineRaw, "gpuDisplayName"),
		gpuTypeId: pickString(machineRaw, "gpuTypeId"),
		location: pickString(machineRaw, "location"),
		podHostId: pickString(machineRaw, "podHostId"),
		secureCloud: pickBool(machineRaw, "secureCloud"),
	};
}

function readDebug(meta: PersonLoraTrainingMeta | null): DebugSummary {
	if (!meta || typeof meta.debug !== "object" || meta.debug === null) {
		return {};
	}
	const raw = meta.debug as Record<string, unknown>;
	return {
		baseModel: pickString(raw, "baseModel"),
		gpuTypeIds: Array.isArray(raw.gpuTypeIds)
			? raw.gpuTypeIds.filter((v): v is string => typeof v === "string")
			: undefined,
		imageName: pickString(raw, "imageName"),
		machine: readMachine(raw),
		podId: pickString(raw, "podId"),
		podLogUrl: pickString(raw, "podLogUrl"),
		runpodPodConsoleUrl: pickString(raw, "runpodPodConsoleUrl"),
		tqdmStep: pickNumber(raw, "tqdmStep"),
		tqdmTotal: pickNumber(raw, "tqdmTotal"),
		trainingModel: pickString(raw, "trainingModel"),
	};
}

function formatDurationMs(value: number | null | undefined) {
	if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
		return null;
	}
	if (value < 1000) {
		return `${value} ms`;
	}
	const seconds = Math.round(value / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatBytes(value: number | null | undefined) {
	if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
		return null;
	}
	if (value < 1024) {
		return `${value} B`;
	}
	const kb = value / 1024;
	if (kb < 1024) {
		return `${kb.toFixed(1)} KB`;
	}
	const mb = kb / 1024;
	if (mb < 1024) {
		return `${mb.toFixed(1)} MB`;
	}
	return `${(mb / 1024).toFixed(2)} GB`;
}

function copyToClipboard(value: string, label: string) {
	if (typeof navigator === "undefined" || !navigator.clipboard) {
		return;
	}
	navigator.clipboard
		.writeText(value)
		.then(() => toast.success(`${label} copied`))
		.catch(() => toast.error(`Failed to copy ${label}`));
}

function Row({
	children,
	label,
}: {
	children: React.ReactNode;
	label: string;
}) {
	return (
		<div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<div className="min-w-0 break-words text-foreground">{children}</div>
		</div>
	);
}

function Mono({
	children,
	copyLabel,
	value,
}: {
	children: React.ReactNode;
	copyLabel?: string;
	value?: string;
}) {
	const handleClick = () => {
		if (value) {
			copyToClipboard(value, copyLabel ?? "value");
		}
	};
	return (
		<span className="inline-flex items-center gap-1">
			<span className="font-mono text-[11px] text-foreground/90">
				{children}
			</span>
			{value ? (
				<button
					aria-label={`Copy ${copyLabel ?? "value"}`}
					className="text-muted-foreground/60 transition hover:text-foreground"
					onClick={handleClick}
					type="button"
				>
					<Copy className="size-3" />
				</button>
			) : null}
		</span>
	);
}

function Section({
	children,
	title,
}: {
	children: React.ReactNode;
	title: string;
}) {
	return (
		<div className="grid gap-1.5 rounded-lg border border-border/40 bg-muted/5 p-3">
			<h4 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				{title}
			</h4>
			<div className="divide-y divide-border/30">{children}</div>
		</div>
	);
}

function HistoryList({
	entries,
}: {
	entries: PersonLoraTrainingHistoryEntry[];
}) {
	if (entries.length === 0) {
		return (
			<p className="text-muted-foreground text-xs">No history entries yet.</p>
		);
	}
	const sorted = [...entries]
		.sort((a, b) => {
			const aTs = Date.parse(a.at ?? "") || 0;
			const bTs = Date.parse(b.at ?? "") || 0;
			return bTs - aTs;
		})
		.slice(0, 25);
	return (
		<ul className="grid gap-1.5">
			{sorted.map((entry, index) => (
				<li
					className="flex items-start gap-2 rounded-md border border-border/30 bg-background/40 px-2 py-1.5 text-[11px]"
					key={`${entry.at ?? "no-ts"}-${index}`}
				>
					<span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
						{entry.at ? formatRelativeTime(entry.at) : "—"}
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-1.5">
							{entry.status ? (
								<span className="rounded-full bg-muted/20 px-1.5 py-0.5 font-medium">
									{entry.status}
								</span>
							) : null}
							{entry.phase ? (
								<span className="rounded-full bg-muted/10 px-1.5 py-0.5 text-muted-foreground">
									{entry.phase}
								</span>
							) : null}
							{typeof entry.progressPct === "number" ? (
								<span className="text-muted-foreground tabular-nums">
									{Math.round(entry.progressPct)}%
								</span>
							) : null}
						</div>
						{entry.errorSummary ? (
							<p className="mt-0.5 text-rose-500">{entry.errorSummary}</p>
						) : null}
					</div>
				</li>
			))}
		</ul>
	);
}

function ExternalLink({
	children,
	href,
}: {
	children: React.ReactNode;
	href: string;
}) {
	return (
		<a
			className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
			href={href}
			rel="noreferrer"
			target="_blank"
		>
			{children}
			<ArrowUpRight className="size-3" />
		</a>
	);
}

function StatusSection({
	effectiveStatus,
	hasLora,
	progressPct,
	training,
}: {
	effectiveStatus: EffectiveStatus;
	hasLora: boolean;
	progressPct: number;
	training: PersonLoraTrainingMeta | null;
}) {
	return (
		<Section title="Status">
			<Row label="Status">
				<span className="rounded-full bg-muted/15 px-2 py-0.5 font-medium text-[11px]">
					{effectiveStatus}
				</span>
				{hasLora ? (
					<span className="ml-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-[11px] text-emerald-700 dark:text-emerald-300">
						weights ready
					</span>
				) : null}
			</Row>
			{training?.phase ? <Row label="Phase">{training.phase}</Row> : null}
			<Row label="Progress">
				<span className="tabular-nums">{progressPct}%</span>
			</Row>
			{training?.triggerWord ? (
				<Row label="Trigger word">
					<Mono copyLabel="trigger word" value={training.triggerWord}>
						{training.triggerWord}
					</Mono>
				</Row>
			) : null}
		</Section>
	);
}

function ProviderSection({
	debug,
	training,
}: {
	debug: DebugSummary;
	training: PersonLoraTrainingMeta | null;
}) {
	const podId = debug.podId ?? training?.providerJobId ?? null;
	return (
		<Section title="Provider">
			{training?.provider ? (
				<Row label="Provider">{training.provider}</Row>
			) : null}
			{training?.providerStatus ? (
				<Row label="Provider status">{training.providerStatus}</Row>
			) : null}
			{podId ? (
				<Row label="Pod ID">
					<Mono copyLabel="pod id" value={podId}>
						{podId}
					</Mono>
				</Row>
			) : null}
			{training?.trainingRunId ? (
				<Row label="Training run">
					<Mono copyLabel="training run id" value={training.trainingRunId}>
						{training.trainingRunId}
					</Mono>
				</Row>
			) : null}
			{debug.runpodPodConsoleUrl ? (
				<Row label="RunPod console">
					<ExternalLink href={debug.runpodPodConsoleUrl}>Open</ExternalLink>
				</Row>
			) : null}
			{debug.podLogUrl ? (
				<Row label="Pod log (S3)">
					<ExternalLink href={debug.podLogUrl}>Download</ExternalLink>
				</Row>
			) : null}
		</Section>
	);
}

function HardwareSection({ debug }: { debug: DebugSummary }) {
	const machine = debug.machine;
	const gpuTypeIds = debug.gpuTypeIds;
	const machineLocation = machine?.location ?? machine?.dataCenterId ?? null;
	const hasAnyHardware = Boolean(machine || gpuTypeIds?.length);
	return (
		<Section title="GPU / hardware">
			{machine?.gpuDisplayName ? (
				<Row label="GPU">
					<span className="font-medium">{machine.gpuDisplayName}</span>
					{machine.gpuCount && machine.gpuCount > 1 ? (
						<span className="ml-1 text-muted-foreground">
							× {machine.gpuCount}
						</span>
					) : null}
				</Row>
			) : null}
			{machine?.gpuTypeId ? (
				<Row label="GPU type ID">
					<Mono copyLabel="gpu type id" value={machine.gpuTypeId}>
						{machine.gpuTypeId}
					</Mono>
				</Row>
			) : null}
			{!machine?.gpuDisplayName && gpuTypeIds?.length ? (
				<Row label="GPU pool (priority)">
					<span className="text-muted-foreground">
						{gpuTypeIds.join(" · ")}
					</span>
				</Row>
			) : null}
			{machineLocation ? (
				<Row label="Datacenter">
					<span>{machineLocation}</span>
					{typeof machine?.secureCloud === "boolean" ? (
						<span className="ml-1.5 rounded-full bg-muted/15 px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
							{machine.secureCloud ? "secure" : "community"}
						</span>
					) : null}
				</Row>
			) : null}
			{typeof machine?.costPerHr === "number" ? (
				<Row label="Cost / hr">
					<span className="tabular-nums">${machine.costPerHr.toFixed(3)}</span>
				</Row>
			) : null}
			{machine?.podHostId ? (
				<Row label="Host ID">
					<Mono copyLabel="host id" value={machine.podHostId}>
						{machine.podHostId}
					</Mono>
				</Row>
			) : null}
			{hasAnyHardware ? null : (
				<p className="py-1.5 text-muted-foreground text-xs">
					Hardware info appears as soon as RunPod assigns a host.
				</p>
			)}
		</Section>
	);
}

function TrainingSection({
	debug,
	training,
}: {
	debug: DebugSummary;
	training: PersonLoraTrainingMeta | null;
}) {
	const elapsed = formatDurationMs(training?.trainingElapsedMs);
	const lastEventAt = training?.lastEventAt ?? training?.updatedAt ?? null;
	const stepsLabel =
		training?.trainingSteps && typeof debug.tqdmStep === "number"
			? `${debug.tqdmStep} / ${debug.tqdmTotal ?? training.trainingSteps}`
			: (training?.trainingSteps ?? null);
	return (
		<Section title="Training">
			{debug.trainingModel ? (
				<Row label="Trainer">{debug.trainingModel}</Row>
			) : null}
			{debug.baseModel ? <Row label="Base model">{debug.baseModel}</Row> : null}
			{debug.imageName ? (
				<Row label="Pod image">
					<Mono copyLabel="image name" value={debug.imageName}>
						{debug.imageName}
					</Mono>
				</Row>
			) : null}
			{stepsLabel === null ? null : (
				<Row label="Steps">
					<span className="tabular-nums">{stepsLabel}</span>
				</Row>
			)}
			{elapsed ? <Row label="Elapsed">{elapsed}</Row> : null}
			{training?.trainingStartedAt ? (
				<Row label="Training started">
					{formatRelativeTime(training.trainingStartedAt)}
				</Row>
			) : null}
			{training?.startedAt ? (
				<Row label="Pipeline started">
					{formatRelativeTime(training.startedAt)}
				</Row>
			) : null}
			{lastEventAt ? (
				<Row label="Last event">{formatRelativeTime(lastEventAt)}</Row>
			) : null}
			{training?.completedAt ? (
				<Row label="Completed">{formatRelativeTime(training.completedAt)}</Row>
			) : null}
		</Section>
	);
}

function ArtifactsSection({
	training,
}: {
	training: PersonLoraTrainingMeta | null;
}) {
	const datasetSize = formatBytes(training?.datasetZipSizeBytes);
	const refsLabel =
		typeof training?.referenceImageCount === "number"
			? `${training.referenceImageCount}${typeof training.referenceImageTargetCount === "number" ? ` / ${training.referenceImageTargetCount}` : ""}`
			: null;
	return (
		<Section title="Dataset & artifacts">
			{refsLabel ? (
				<Row label="References">
					<span className="tabular-nums">{refsLabel}</span>
				</Row>
			) : null}
			{datasetSize ? <Row label="Dataset size">{datasetSize}</Row> : null}
			{training?.datasetUrl ? (
				<Row label="Dataset zip">
					<ExternalLink href={training.datasetUrl}>Download</ExternalLink>
				</Row>
			) : null}
			{training?.loraUrl ? (
				<Row label="LoRA weights">
					<ExternalLink href={training.loraUrl}>
						Download .safetensors
					</ExternalLink>
				</Row>
			) : null}
			{training?.uploadMethod ? (
				<Row label="Upload">{training.uploadMethod}</Row>
			) : null}
		</Section>
	);
}

export function TrainingDetailsDialog({
	effectiveStatus,
	hasLora,
	onOpenChange,
	open,
	personName,
	progressPct,
	training,
}: {
	effectiveStatus: EffectiveStatus;
	hasLora: boolean;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	personName: string;
	progressPct: number;
	training: PersonLoraTrainingMeta | null;
}) {
	const debug = readDebug(training);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Training details · {personName}</DialogTitle>
					<DialogDescription>
						Live snapshot of the LoRA training pipeline — provider, hardware,
						and progress data straight from the worker.
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="grid gap-3">
					<StatusSection
						effectiveStatus={effectiveStatus}
						hasLora={hasLora}
						progressPct={progressPct}
						training={training}
					/>
					<ProviderSection debug={debug} training={training} />
					<HardwareSection debug={debug} />
					<TrainingSection debug={debug} training={training} />
					<ArtifactsSection training={training} />
					{training?.errorSummary ? (
						<Section title="Error">
							<p className="py-1.5 text-rose-500 text-xs">
								{training.errorSummary}
							</p>
						</Section>
					) : null}
					{training?.debugCorrelationId ? (
						<Section title="Diagnostics">
							<Row label="Correlation ID">
								<Mono
									copyLabel="correlation id"
									value={training.debugCorrelationId}
								>
									{training.debugCorrelationId}
								</Mono>
							</Row>
						</Section>
					) : null}
					{training?.history?.length ? (
						<Section title={`History · ${training.history.length}`}>
							<HistoryList entries={training.history} />
						</Section>
					) : null}
				</DialogBody>
				<div className="flex items-center justify-end border-border/60 border-t bg-muted/30 px-5 py-3">
					<Button onClick={() => onOpenChange(false)} variant="ghost">
						Close
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
