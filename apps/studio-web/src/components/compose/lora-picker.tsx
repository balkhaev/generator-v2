"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { cn } from "@generator/ui/lib/utils";
import {
	Check,
	ExternalLink,
	Layers3,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";

import RangeSlider from "./range-slider";

interface WeightConfig {
	max: number;
	min: number;
	step: number;
}

interface LoraPickerProps {
	adminHref: string;
	allowNone?: boolean;
	baseModelHint?: string;
	emptyHint?: string;
	loras: LoraRegistryEntry[];
	onUrlChange: (url: string) => void;
	onWeightChange?: (weight: number) => void;
	title: string;
	url: string;
	weight?: number;
	weightConfig?: WeightConfig;
	weightLabel?: string;
}

function formatBytes(bytes: number) {
	if (!bytes) {
		return "";
	}

	const mb = bytes / (1024 * 1024);

	if (mb >= 1024) {
		return `${(mb / 1024).toFixed(1)} GB`;
	}

	if (mb >= 1) {
		return `${mb.toFixed(0)} MB`;
	}

	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function PickerHeader({
	adminHref,
	baseModelHint,
	title,
}: {
	adminHref: string;
	baseModelHint?: string;
	title: string;
}) {
	return (
		<header className="flex items-center justify-between gap-2">
			<div className="flex min-w-0 items-center gap-2">
				<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/8">
					<Layers3
						aria-hidden="true"
						className="size-3.5 text-foreground/70"
						strokeWidth={1.5}
					/>
				</div>
				<div className="min-w-0">
					<p className="truncate font-medium text-xs">{title}</p>
					{baseModelHint ? (
						<p className="truncate text-[10px] text-muted-foreground">
							{baseModelHint}
						</p>
					) : null}
				</div>
			</div>
			<a
				className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10px] text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
				href={adminHref}
				rel="noreferrer noopener"
				target="_blank"
			>
				Manage
				<ExternalLink className="size-2.5" />
			</a>
		</header>
	);
}

function SelectedLoraCard({
	allowNone,
	entry,
	onClear,
}: {
	allowNone?: boolean;
	entry: LoraRegistryEntry;
	onClear: () => void;
}) {
	return (
		<div className="flex items-start gap-2.5 rounded-lg bg-foreground/[0.04] p-2.5">
			<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/10">
				<Sparkles
					aria-hidden="true"
					className="size-3.5 text-foreground/70"
					strokeWidth={1.5}
				/>
			</div>
			<div className="min-w-0 flex-1 space-y-0.5">
				<p className="truncate font-medium text-[11px]">{entry.name}</p>
				<p className="line-clamp-2 text-[10px] text-muted-foreground leading-snug">
					{entry.description || entry.slug}
				</p>
				<div className="flex flex-wrap items-center gap-1 pt-0.5 text-[10px] text-muted-foreground/80">
					<span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 uppercase tracking-wide">
						{entry.baseModel}
					</span>
					<span>default {entry.defaultWeight}</span>
					{entry.sizeBytes ? (
						<>
							<span>·</span>
							<span>{formatBytes(entry.sizeBytes)}</span>
						</>
					) : null}
				</div>
			</div>
			{allowNone ? (
				<button
					aria-label="Clear LoRA"
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
					onClick={onClear}
					type="button"
				>
					<X className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}

function CustomUrlNotice({
	onClear,
	url,
}: {
	onClear: () => void;
	url: string;
}) {
	return (
		<div className="grid gap-1.5 rounded-lg bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-300">
			<p className="text-[11px]">Custom URL is used (not in the registry).</p>
			<p className="break-all text-[10px] text-amber-700/80 dark:text-amber-300/70">
				{url}
			</p>
			<button
				className="self-start text-[10px] underline"
				onClick={onClear}
				type="button"
			>
				Clear
			</button>
		</div>
	);
}

function WeightControl({
	disabled,
	matchedDefault,
	onChange,
	value,
	weightConfig,
	weightLabel,
}: {
	disabled: boolean;
	matchedDefault: number | null;
	onChange: (next: number) => void;
	value: number | undefined;
	weightConfig: WeightConfig;
	weightLabel: string;
}) {
	const showReset =
		matchedDefault !== null &&
		value !== undefined &&
		Math.abs(value - matchedDefault) > 0.001;

	return (
		<div className="grid gap-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[11px] text-muted-foreground">{weightLabel}</span>
				{showReset ? (
					<button
						className="text-[10px] text-muted-foreground underline transition hover:text-foreground"
						onClick={() => onChange(matchedDefault)}
						type="button"
					>
						Reset to default
					</button>
				) : null}
			</div>
			<RangeSlider
				disabled={disabled}
				max={weightConfig.max}
				min={weightConfig.min}
				onValueChange={onChange}
				step={weightConfig.step}
				value={value ?? weightConfig.min}
			/>
		</div>
	);
}

function LoraSearchList({
	adminHref,
	emptyHint,
	loras,
	onSelect,
	query,
	totalCount,
	url,
}: {
	adminHref: string;
	emptyHint?: string;
	loras: LoraRegistryEntry[];
	onSelect: (entry: LoraRegistryEntry) => void;
	query: string;
	totalCount: number;
	url: string;
}) {
	if (loras.length === 0) {
		return (
			<div className="grid gap-2 rounded-lg bg-foreground/[0.03] px-3 py-4 text-center text-[11px] text-muted-foreground">
				<Layers3
					aria-hidden="true"
					className="mx-auto size-4 text-muted-foreground/50"
					strokeWidth={1.5}
				/>
				<p>{totalCount > 0 && query ? "No matches." : "No LoRAs available."}</p>
				{emptyHint ? <p className="text-[10px]">{emptyHint}</p> : null}
				<a
					className="self-center text-[10px] underline transition hover:text-foreground"
					href={adminHref}
					rel="noreferrer noopener"
					target="_blank"
				>
					Open LoRA admin
				</a>
			</div>
		);
	}

	return (
		<ul className="grid max-h-64 gap-0.5 overflow-y-auto pr-0.5">
			{loras.map((entry) => {
				const isActive = entry.s3Url === url;
				return (
					<li key={entry.id}>
						<button
							aria-pressed={isActive}
							className={cn(
								"flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition",
								isActive ? "bg-foreground/8" : "hover:bg-foreground/[0.04]"
							)}
							onClick={() => onSelect(entry)}
							type="button"
						>
							<div
								className={cn(
									"flex size-5 shrink-0 items-center justify-center rounded-full border transition",
									isActive
										? "border-foreground bg-foreground text-background"
										: "border-foreground/15"
								)}
							>
								{isActive ? (
									<Check className="size-3" strokeWidth={2.5} />
								) : null}
							</div>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-[11px]">{entry.name}</p>
								<p className="truncate text-[10px] text-muted-foreground">
									{entry.description || entry.slug}
								</p>
							</div>
							<span className="shrink-0 self-center rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] text-muted-foreground uppercase tracking-wide">
								{entry.baseModel}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

export default function LoraPicker({
	adminHref,
	allowNone,
	baseModelHint,
	emptyHint,
	loras,
	onUrlChange,
	onWeightChange,
	title,
	url,
	weight,
	weightConfig,
	weightLabel = "Weight",
}: LoraPickerProps) {
	const [query, setQuery] = useState("");

	const filteredLoras = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return loras;
		}
		return loras.filter(
			(entry) =>
				entry.name.toLowerCase().includes(normalized) ||
				entry.slug.toLowerCase().includes(normalized) ||
				entry.description.toLowerCase().includes(normalized)
		);
	}, [loras, query]);

	const matchedEntry = loras.find((entry) => entry.s3Url === url) ?? null;
	const hasCustomUrl = url.length > 0 && !matchedEntry;

	function handleSelect(entry: LoraRegistryEntry) {
		onUrlChange(entry.s3Url);

		if (
			onWeightChange &&
			weightConfig &&
			(weight === undefined || weight === weightConfig.min)
		) {
			const target = Math.min(
				Math.max(entry.defaultWeight, weightConfig.min),
				weightConfig.max
			);
			onWeightChange(target);
		}
	}

	return (
		<div className="grid gap-2.5 rounded-xl border border-foreground/8 bg-background/40 p-2.5">
			<PickerHeader
				adminHref={adminHref}
				baseModelHint={baseModelHint}
				title={title}
			/>

			{matchedEntry ? (
				<SelectedLoraCard
					allowNone={allowNone}
					entry={matchedEntry}
					onClear={() => onUrlChange("")}
				/>
			) : null}

			{hasCustomUrl ? (
				<CustomUrlNotice onClear={() => onUrlChange("")} url={url} />
			) : null}

			{weightConfig && onWeightChange ? (
				<WeightControl
					disabled={!url}
					matchedDefault={matchedEntry?.defaultWeight ?? null}
					onChange={onWeightChange}
					value={weight}
					weightConfig={weightConfig}
					weightLabel={weightLabel}
				/>
			) : null}

			<div className="grid gap-1.5">
				<div className="relative">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Search LoRAs"
						className="h-7 pr-2 pl-7 text-[11px]"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search by name, slug, description"
						value={query}
					/>
				</div>

				<LoraSearchList
					adminHref={adminHref}
					emptyHint={emptyHint}
					loras={filteredLoras}
					onSelect={handleSelect}
					query={query}
					totalCount={loras.length}
					url={url}
				/>
			</div>

			{allowNone && url ? (
				<Button
					onClick={() => onUrlChange("")}
					size="xs"
					type="button"
					variant="ghost"
				>
					Clear selection
				</Button>
			) : null}
		</div>
	);
}
