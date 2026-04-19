"use client";

import type {
	LoraRegistryEntry,
	LoraVariant,
} from "@generator/contracts/loras";
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

// Map a LoRA variant to the matching slot urlKey. Wan 2.2 workflows expose
// `loraUrlHigh` and `loraUrlLow`; everything else uses a single `loraUrl`.
function getSlotIndexForVariant(
	resolved: ResolvedSlot[],
	variant: LoraVariant | null
): number {
	if (!variant || variant === "both") {
		return -1;
	}
	const targetSuffix = variant === "high" ? "High" : "Low";
	return resolved.findIndex((slot) =>
		slot.definition.urlKey.endsWith(targetSuffix)
	);
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
		<div className="grid gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/8 p-2.5 shadow-sm dark:border-emerald-400/30 dark:bg-emerald-500/[0.08]">
			<div className="flex items-start gap-2.5">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
					<Sparkles aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<Check
							aria-hidden="true"
							className="size-3 text-emerald-600 dark:text-emerald-400"
							strokeWidth={2.5}
						/>
						<p className="truncate font-medium text-[12px] text-foreground">
							{entry.name}
						</p>
						{entry.variant && entry.variant !== "both" ? (
							<span className="rounded-full border border-emerald-500/40 px-1.5 py-0.5 font-medium text-[9px] text-emerald-700 uppercase tracking-wide dark:text-emerald-300">
								{entry.variant === "high" ? "High noise" : "Low noise"}
							</span>
						) : null}
					</div>
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
	/**
	 * Restricts the picker to entries matching this variant. Used for wan 2.2
	 * workflows where each slot targets a specific transformer (high/low) and
	 * we want to surface only relevant LoRAs for the slot being filled.
	 */
	restrictVariant?: LoraVariant;
}

function PickerPopover({
	adminHref,
	availableLoras,
	excludedUrls,
	onClose,
	onPickEntry,
	restrictVariant,
}: PickerPopoverProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");

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
		const visible = availableLoras.filter((entry) => {
			if (excludedUrls.has(entry.s3Url)) {
				return false;
			}
			// Show entries marked for this transformer plus `both`/null which
			// can be loaded into either side.
			if (
				restrictVariant &&
				entry.variant &&
				entry.variant !== "both" &&
				entry.variant !== restrictVariant
			) {
				return false;
			}
			return true;
		});
		if (!normalized) {
			return visible;
		}
		return visible.filter(
			(entry) =>
				entry.name.toLowerCase().includes(normalized) ||
				entry.slug.toLowerCase().includes(normalized) ||
				entry.description.toLowerCase().includes(normalized)
		);
	}, [availableLoras, excludedUrls, query, restrictVariant]);

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
				<a
					className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground underline transition hover:text-foreground"
					href={adminHref}
					rel="noreferrer noopener"
					target="_blank"
				>
					<Plus className="size-3" />
					Add new LoRA in admin
					<ExternalLink className="size-2.5" />
				</a>
			</div>
		</div>
	);
}

function resolveSlotWeightBindings(
	slot: ResolvedSlot,
	form: ScenarioFormState,
	onParamChange: (key: string, value: string) => void
): {
	numericWeight?: number;
	onWeightChange?: (next: number) => void;
	weightConfig?: { max: number; min: number; step: number };
	weightLabel: string;
} {
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

	return {
		numericWeight,
		onWeightChange,
		weightConfig,
		weightLabel: slot.weightParameter?.label ?? "Weight",
	};
}

function LoraFilledSlotContents({
	adminHref,
	availableLoras,
	form,
	onClearSlot,
	onParamChange,
	slot,
}: {
	adminHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	onClearSlot: (urlKey: string) => void;
	onParamChange: (key: string, value: string) => void;
	slot: ResolvedSlot;
}) {
	const matchedEntry =
		availableLoras.find((entry) => entry.s3Url === slot.url) ?? null;
	const w = resolveSlotWeightBindings(slot, form, onParamChange);
	if (matchedEntry) {
		return (
			<SlotPickerCard
				adminHref={adminHref}
				availableLoras={availableLoras}
				entry={matchedEntry}
				onClear={() => onClearSlot(slot.definition.urlKey)}
				onWeightChange={w.onWeightChange}
				weight={w.numericWeight}
				weightConfig={w.weightConfig}
				weightLabel={w.weightLabel}
			/>
		);
	}
	return (
		<CustomUrlSlot
			onClear={() => onClearSlot(slot.definition.urlKey)}
			onWeightChange={w.onWeightChange}
			url={slot.url}
			weight={w.numericWeight}
			weightConfig={w.weightConfig}
			weightLabel={w.weightLabel}
		/>
	);
}

function LoraEmptySlotPickerRow({
	adminHref,
	availableLoras,
	excludedUrls,
	isMultiSlot,
	onPickEntry,
	openSlotKey,
	restrictVariant,
	setOpenSlotKey,
	slot,
	slotIndex,
}: {
	adminHref: string;
	availableLoras: LoraRegistryEntry[];
	excludedUrls: Set<string>;
	isMultiSlot: boolean;
	onPickEntry: (entry: LoraRegistryEntry, slotIndex: number) => void;
	openSlotKey: string | null;
	restrictVariant?: LoraVariant;
	setOpenSlotKey: (key: string | null) => void;
	slot: ResolvedSlot;
	slotIndex: number;
}) {
	const isOpen = openSlotKey === slot.definition.urlKey;
	return (
		<div className="relative">
			<Button
				className="w-full justify-center gap-1.5"
				onClick={() => setOpenSlotKey(isOpen ? null : slot.definition.urlKey)}
				size="sm"
				type="button"
				variant="outline"
			>
				<Plus className="size-3.5" />
				{isMultiSlot ? `Add ${slot.definition.label}` : "Add LoRA"}
			</Button>
			{isOpen ? (
				<PickerPopover
					adminHref={adminHref}
					availableLoras={availableLoras}
					excludedUrls={excludedUrls}
					onClose={() => setOpenSlotKey(null)}
					onPickEntry={(entry) => onPickEntry(entry, slotIndex)}
					restrictVariant={restrictVariant}
				/>
			) : null}
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
	const [openSlotKey, setOpenSlotKey] = useState<string | null>(null);

	const resolved = useMemo(
		() => resolveSlots(slots, workflow, form),
		[slots, workflow, form]
	);

	const filledSlots = resolved.filter((slot) => slot.url);
	const openSlotIndex = findOpenSlotIndex(resolved);
	const canAdd = openSlotIndex >= 0;
	const excludedUrls = new Set(filledSlots.map((slot) => slot.url));

	function fillSlot(slotIndex: number, url: string, defaultWeight?: number) {
		const slot = resolved[slotIndex];
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
			const clamped = Math.min(
				Math.max(defaultWeight, slot.weightParameter.min),
				slot.weightParameter.max
			);
			onParamChange(slot.weightParameter.key, String(clamped));
		}
	}

	function autoFillPaired(entry: LoraRegistryEntry, sourceSlotIndex: number) {
		// Wan 2.2 LoRAs are imported as a high+low pair sharing a pairGroupId.
		// When the user picks one, find the matching variant and place it into
		// the opposite slot so they don't have to repeat the search.
		if (!(entry.pairGroupId && entry.variant) || entry.variant === "both") {
			return;
		}
		const paired = availableLoras.find(
			(other) =>
				other.id !== entry.id &&
				other.pairGroupId === entry.pairGroupId &&
				other.variant &&
				other.variant !== entry.variant &&
				other.variant !== "both"
		);
		if (!paired) {
			return;
		}
		const pairedSlotIndex = getSlotIndexForVariant(resolved, paired.variant);
		if (pairedSlotIndex >= 0 && pairedSlotIndex !== sourceSlotIndex) {
			fillSlot(pairedSlotIndex, paired.s3Url, paired.defaultWeight);
		}
	}

	function handlePickEntryForSlot(entry: LoraRegistryEntry, slotIndex: number) {
		fillSlot(slotIndex, entry.s3Url, entry.defaultWeight);
		autoFillPaired(entry, slotIndex);
		setOpenSlotKey(null);
	}

	function handleClearSlot(urlKey: string) {
		onParamChange(urlKey, "");
	}

	// Workflows like Wan 2.2 expose two LoRA slots — one per transformer.
	// In that case we render each slot as its own section with its own picker
	// instead of the single "Add LoRA" button used by single-slot workflows.
	const isMultiSlot = slots.length > 1;

	function getSlotVariant(slot: ResolvedSlot): LoraVariant | undefined {
		if (slot.definition.urlKey.endsWith("High")) {
			return "high";
		}
		if (slot.definition.urlKey.endsWith("Low")) {
			return "low";
		}
		return;
	}

	function renderSlotContents(slot: ResolvedSlot, slotIndex: number) {
		if (slot.url) {
			return (
				<LoraFilledSlotContents
					adminHref={adminHref}
					availableLoras={availableLoras}
					form={form}
					onClearSlot={handleClearSlot}
					onParamChange={onParamChange}
					slot={slot}
				/>
			);
		}
		return (
			<LoraEmptySlotPickerRow
				adminHref={adminHref}
				availableLoras={availableLoras}
				excludedUrls={excludedUrls}
				isMultiSlot={isMultiSlot}
				onPickEntry={handlePickEntryForSlot}
				openSlotKey={openSlotKey}
				restrictVariant={getSlotVariant(slot)}
				setOpenSlotKey={setOpenSlotKey}
				slot={slot}
				slotIndex={slotIndex}
			/>
		);
	}

	return (
		<div className="grid gap-2">
			{isMultiSlot ? (
				<div className="grid gap-2">
					{resolved.map((slot, slotIndex) => (
						<div className="grid gap-1.5" key={slot.definition.urlKey}>
							<div className="flex items-center justify-between gap-2 px-0.5">
								<span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
									{slot.definition.label}
									{slot.definition.optional ? (
										<span className="ml-1 text-[9px] text-muted-foreground/60 normal-case">
											optional
										</span>
									) : null}
								</span>
							</div>
							{renderSlotContents(slot, slotIndex)}
						</div>
					))}
				</div>
			) : (
				<div className="grid gap-2">
					{resolved.map((slot, slotIndex) => (
						<div key={slot.definition.urlKey}>
							{renderSlotContents(slot, slotIndex)}
						</div>
					))}
				</div>
			)}
			{!isMultiSlot && filledSlots.length > 0 && canAdd ? (
				<div className="text-[10px] text-muted-foreground">
					{filledSlots.length}/{slots.length} slot
					{slots.length === 1 ? "" : "s"} filled
				</div>
			) : null}
		</div>
	);
}

export type { LoraStackProps };
