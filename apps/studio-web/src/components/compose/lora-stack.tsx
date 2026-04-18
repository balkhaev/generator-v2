"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import type {
	ScenarioFormState,
	WorkflowDefinition,
	WorkflowParameter,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import {
	Check,
	ExternalLink,
	Layers3,
	Link as LinkIcon,
	Plus,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import RangeSlider from "./range-slider";
import type { LoraSlotDefinition } from "./workflow-matrix";

interface LoraStackProps {
	adminHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	onParamChange: (key: string, value: string) => void;
	slots: LoraSlotDefinition[];
	workflow: WorkflowDefinition;
}

interface ResolvedSlot {
	definition: LoraSlotDefinition;
	url: string;
	weightParameter: WorkflowParameter | null;
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

function resolveSlots(
	slots: LoraSlotDefinition[],
	workflow: WorkflowDefinition,
	form: ScenarioFormState
): ResolvedSlot[] {
	return slots.map((slot) => {
		const weightParameter = slot.weightKey
			? (workflow.parameters.find(
					(parameter) => parameter.key === slot.weightKey
				) ?? null)
			: null;
		return {
			definition: slot,
			url: form.params[slot.urlKey] ?? "",
			weightParameter,
		};
	});
}

function findOpenSlotIndex(resolved: ResolvedSlot[]) {
	return resolved.findIndex((slot) => !slot.url);
}

function SlotPickerCard({
	adminHref,
	availableLoras,
	entry,
	onClear,
	onWeightChange,
	weight,
	weightConfig,
	weightLabel,
}: {
	adminHref: string;
	availableLoras: LoraRegistryEntry[];
	entry: LoraRegistryEntry | null;
	onClear: () => void;
	onWeightChange?: (next: number) => void;
	weight?: number;
	weightConfig?: { max: number; min: number; step: number };
	weightLabel: string;
}) {
	if (!entry) {
		return null;
	}

	const showWeight = Boolean(weightConfig && onWeightChange);

	return (
		<div className="grid gap-2 rounded-lg border border-foreground/8 bg-background/40 p-2.5">
			<div className="flex items-start gap-2.5">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/10">
					<Sparkles
						aria-hidden="true"
						className="size-3.5 text-foreground/70"
						strokeWidth={1.5}
					/>
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-[12px]">{entry.name}</p>
					{entry.description ? (
						<p className="line-clamp-1 text-[10px] text-muted-foreground">
							{entry.description}
						</p>
					) : null}
					<div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground/80">
						<span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 uppercase tracking-wide">
							{entry.baseModel}
						</span>
						<span>default {entry.defaultWeight}</span>
						{entry.sizeBytes ? (
							<span>· {formatBytes(entry.sizeBytes)}</span>
						) : null}
					</div>
					{availableLoras.length === 0 ? (
						<a
							className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground underline transition hover:text-foreground"
							href={adminHref}
							rel="noreferrer noopener"
							target="_blank"
						>
							Manage LoRAs
							<ExternalLink className="size-2.5" />
						</a>
					) : null}
				</div>
				<button
					aria-label="Remove LoRA"
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
					onClick={onClear}
					type="button"
				>
					<X className="size-3.5" />
				</button>
			</div>

			{showWeight && weightConfig && onWeightChange ? (
				<div className="grid gap-1 px-0.5">
					<div className="flex items-center justify-between gap-2">
						<span className="text-[10px] text-muted-foreground">
							{weightLabel}
						</span>
					</div>
					<RangeSlider
						max={weightConfig.max}
						min={weightConfig.min}
						onValueChange={onWeightChange}
						step={weightConfig.step}
						value={weight ?? weightConfig.min}
					/>
				</div>
			) : null}
		</div>
	);
}

function CustomUrlSlot({
	onClear,
	onWeightChange,
	url,
	weight,
	weightConfig,
	weightLabel,
}: {
	onClear: () => void;
	onWeightChange?: (next: number) => void;
	url: string;
	weight?: number;
	weightConfig?: { max: number; min: number; step: number };
	weightLabel: string;
}) {
	return (
		<div className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 p-2.5 dark:border-amber-400/30">
			<div className="flex items-start gap-2.5">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300">
					<LinkIcon className="size-3.5" strokeWidth={1.5} />
				</div>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-[12px] text-amber-800 dark:text-amber-200">
						Custom URL
					</p>
					<p className="break-all text-[10px] text-amber-700/80 dark:text-amber-300/70">
						{url}
					</p>
				</div>
				<button
					aria-label="Remove LoRA"
					className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
					onClick={onClear}
					type="button"
				>
					<X className="size-3.5" />
				</button>
			</div>
			{weightConfig && onWeightChange ? (
				<div className="grid gap-1 px-0.5">
					<span className="text-[10px] text-muted-foreground">
						{weightLabel}
					</span>
					<RangeSlider
						max={weightConfig.max}
						min={weightConfig.min}
						onValueChange={onWeightChange}
						step={weightConfig.step}
						value={weight ?? weightConfig.min}
					/>
				</div>
			) : null}
		</div>
	);
}

interface PickerPopoverProps {
	adminHref: string;
	availableLoras: LoraRegistryEntry[];
	excludedUrls: Set<string>;
	onClose: () => void;
	onPickEntry: (entry: LoraRegistryEntry) => void;
	onPickUrl: (url: string) => void;
}

function PickerPopover({
	adminHref,
	availableLoras,
	excludedUrls,
	onClose,
	onPickEntry,
	onPickUrl,
}: PickerPopoverProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [customUrl, setCustomUrl] = useState("");

	useEffect(() => {
		function handleClick(event: MouseEvent) {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		}
		function handleKeydown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKeydown);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKeydown);
		};
	}, [onClose]);

	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		const visible = availableLoras.filter(
			(entry) => !excludedUrls.has(entry.s3Url)
		);
		if (!normalized) {
			return visible;
		}
		return visible.filter(
			(entry) =>
				entry.name.toLowerCase().includes(normalized) ||
				entry.slug.toLowerCase().includes(normalized) ||
				entry.description.toLowerCase().includes(normalized)
		);
	}, [availableLoras, excludedUrls, query]);

	function handleAddCustom() {
		const trimmed = customUrl.trim();
		if (!trimmed) {
			return;
		}
		try {
			new URL(trimmed);
		} catch {
			return;
		}
		onPickUrl(trimmed);
	}

	return (
		<div
			className="absolute top-full right-0 left-0 z-20 mt-1.5 grid gap-2 rounded-xl border border-foreground/10 bg-popover p-2.5 shadow-lg"
			ref={containerRef}
		>
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

			{filtered.length > 0 ? (
				<ul className="grid max-h-64 gap-0.5 overflow-y-auto pr-0.5">
					{filtered.map((entry) => (
						<li key={entry.id}>
							<button
								className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-foreground/[0.05]"
								onClick={() => onPickEntry(entry)}
								type="button"
							>
								<div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-foreground/15">
									<Check className="size-3 opacity-0" strokeWidth={2.5} />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-[11px]">
										{entry.name}
									</p>
									<p className="truncate text-[10px] text-muted-foreground">
										{entry.description || entry.slug}
									</p>
								</div>
								<span className="shrink-0 self-center rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] text-muted-foreground uppercase tracking-wide">
									{entry.baseModel}
								</span>
							</button>
						</li>
					))}
				</ul>
			) : (
				<div className="grid gap-1.5 rounded-lg bg-foreground/[0.03] px-3 py-3 text-center text-[11px] text-muted-foreground">
					<Layers3
						aria-hidden="true"
						className="mx-auto size-4 text-muted-foreground/50"
						strokeWidth={1.5}
					/>
					<p>
						{availableLoras.length === 0
							? "No LoRAs in registry."
							: "No matches."}
					</p>
					<a
						className="self-center text-[10px] underline transition hover:text-foreground"
						href={adminHref}
						rel="noreferrer noopener"
						target="_blank"
					>
						Open LoRA admin
					</a>
				</div>
			)}

			<div className="border-foreground/8 border-t pt-2">
				<p className="mb-1 text-[10px] text-muted-foreground">
					Or paste a public URL:
				</p>
				<div className="flex gap-1.5">
					<Input
						className="h-7 flex-1 text-[11px]"
						onChange={(event) => setCustomUrl(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleAddCustom();
							}
						}}
						placeholder="https://…/lora.safetensors"
						value={customUrl}
					/>
					<Button
						disabled={!customUrl.trim()}
						onClick={handleAddCustom}
						size="xs"
						type="button"
					>
						Add
					</Button>
				</div>
			</div>
		</div>
	);
}

export default function LoraStack({
	adminHref,
	availableLoras,
	form,
	onParamChange,
	slots,
	workflow,
}: LoraStackProps) {
	const [pickerOpen, setPickerOpen] = useState(false);

	const resolved = useMemo(
		() => resolveSlots(slots, workflow, form),
		[slots, workflow, form]
	);

	const filledSlots = resolved.filter((slot) => slot.url);
	const openSlotIndex = findOpenSlotIndex(resolved);
	const canAdd = openSlotIndex >= 0;
	const excludedUrls = new Set(filledSlots.map((slot) => slot.url));

	function handleAdd(url: string, defaultWeight?: number) {
		if (!canAdd) {
			return;
		}
		const slot = resolved[openSlotIndex];
		if (!slot) {
			return;
		}
		onParamChange(slot.definition.urlKey, url);
		if (
			slot.weightParameter &&
			defaultWeight !== undefined &&
			slot.weightParameter.min !== undefined &&
			slot.weightParameter.max !== undefined
		) {
			const target = Math.min(
				Math.max(defaultWeight, slot.weightParameter.min),
				slot.weightParameter.max
			);
			onParamChange(slot.weightParameter.key, String(target));
		}
		setPickerOpen(false);
	}

	function handlePickEntry(entry: LoraRegistryEntry) {
		handleAdd(entry.s3Url, entry.defaultWeight);
	}

	function handleClearSlot(urlKey: string) {
		onParamChange(urlKey, "");
	}

	return (
		<div className="grid gap-2">
			<div className="grid gap-2">
				{resolved.map((slot) => {
					if (!slot.url) {
						return null;
					}
					const matchedEntry =
						availableLoras.find((entry) => entry.s3Url === slot.url) ?? null;

					const weightConfig =
						slot.weightParameter &&
						slot.weightParameter.min !== undefined &&
						slot.weightParameter.max !== undefined
							? {
									max: slot.weightParameter.max,
									min: slot.weightParameter.min,
									step: slot.weightParameter.step ?? 0.05,
								}
							: undefined;

					const weightValue = slot.weightParameter
						? Number(form.params[slot.weightParameter.key])
						: undefined;
					const numericWeight = Number.isFinite(weightValue)
						? (weightValue as number)
						: undefined;

					const onWeightChange = slot.weightParameter
						? (next: number) =>
								onParamChange(
									(slot.weightParameter as WorkflowParameter).key,
									String(next)
								)
						: undefined;

					if (matchedEntry) {
						return (
							<SlotPickerCard
								adminHref={adminHref}
								availableLoras={availableLoras}
								entry={matchedEntry}
								key={slot.definition.urlKey}
								onClear={() => handleClearSlot(slot.definition.urlKey)}
								onWeightChange={onWeightChange}
								weight={numericWeight}
								weightConfig={weightConfig}
								weightLabel={slot.weightParameter?.label ?? "Weight"}
							/>
						);
					}

					return (
						<CustomUrlSlot
							key={slot.definition.urlKey}
							onClear={() => handleClearSlot(slot.definition.urlKey)}
							onWeightChange={onWeightChange}
							url={slot.url}
							weight={numericWeight}
							weightConfig={weightConfig}
							weightLabel={slot.weightParameter?.label ?? "Weight"}
						/>
					);
				})}
			</div>

			<div className="relative">
				<Button
					className="w-full justify-center gap-1.5"
					disabled={!canAdd}
					onClick={() => setPickerOpen((current) => !current)}
					size="sm"
					type="button"
					variant="outline"
				>
					<Plus className="size-3.5" />
					{canAdd
						? `Add LoRA${slots.length > 1 ? ` (${filledSlots.length}/${slots.length})` : ""}`
						: `Maximum ${slots.length} LoRA${slots.length === 1 ? "" : "s"}`}
				</Button>

				{pickerOpen ? (
					<PickerPopover
						adminHref={adminHref}
						availableLoras={availableLoras}
						excludedUrls={excludedUrls}
						onClose={() => setPickerOpen(false)}
						onPickEntry={handlePickEntry}
						onPickUrl={(url) => handleAdd(url)}
					/>
				) : null}
			</div>
		</div>
	);
}

export type { LoraStackProps };
