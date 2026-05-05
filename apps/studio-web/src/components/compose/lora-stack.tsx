"use client";

import {
	LORA_BASE_MODELS,
	type LoraBaseModel,
	type LoraRegistryEntry,
	type LoraSourcePreview,
	type LoraSourcePreviewVariant,
	type LoraVariant,
} from "@generator/contracts/loras";
import {
	importStudioLoraFromUrl,
	previewStudioLoraSource,
} from "@generator/studio-client/client";
import type {
	ScenarioFormState,
	WorkflowDefinition,
	WorkflowParameter,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import {
	Check,
	Download,
	ExternalLink,
	Eye,
	Layers3,
	Link as LinkIcon,
	Loader2,
	Plus,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import RangeSlider from "./range-slider";
import type { LoraSlotDefinition } from "./workflow-matrix";

interface LoraStackProps {
	adminHref: string;
	availableLoras: LoraRegistryEntry[];
	form: ScenarioFormState;
	onLorasImported?: (entries: LoraRegistryEntry[]) => void;
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

function isNoiseSlot(slot: ResolvedSlot): boolean {
	return (
		slot.definition.urlKey.endsWith("High") ||
		slot.definition.urlKey.endsWith("Low")
	);
}

function canApplyToBothNoiseSlots(entry: LoraRegistryEntry): boolean {
	return entry.variant === "both" || entry.variant === null;
}

const civitaiHostPattern = /(^|\.)civitai\.(com|red)$/iu;

function isCivitaiUrl(value: string): boolean {
	try {
		return civitaiHostPattern.test(new URL(value).hostname);
	} catch {
		return false;
	}
}

function asLoraBaseModel(value: string | undefined): LoraBaseModel | undefined {
	if (!value) {
		return;
	}
	return LORA_BASE_MODELS.includes(value as LoraBaseModel)
		? (value as LoraBaseModel)
		: undefined;
}

function findPreviewVariant(
	preview: LoraSourcePreview | null,
	selectedVersionId: number | null
): LoraSourcePreviewVariant | null {
	if (!preview?.variants || selectedVersionId === null) {
		return null;
	}
	return (
		preview.variants.find(
			(variant) => variant.versionId === selectedVersionId
		) ?? null
	);
}

function resolveImportBaseModel(input: {
	activeVariant: LoraSourcePreviewVariant | null;
	preview: LoraSourcePreview | null;
	workflowBaseModel?: string;
}): LoraBaseModel {
	const workflowBaseModel = asLoraBaseModel(input.workflowBaseModel);
	const detectedBaseModel =
		input.activeVariant?.baseModel ?? input.preview?.baseModel;
	if (
		workflowBaseModel &&
		detectedBaseModel &&
		workflowBaseModel !== detectedBaseModel
	) {
		throw new Error(
			`Civitai base model ${detectedBaseModel} does not match this workflow (${workflowBaseModel}).`
		);
	}
	return workflowBaseModel ?? detectedBaseModel ?? "other";
}

function getDetectedPair(preview: LoraSourcePreview | null) {
	const pairedFiles = preview?.pairedFiles ?? [];
	if (pairedFiles.length !== 2) {
		return null;
	}
	const high = pairedFiles.find((file) => file.variant === "high");
	const low = pairedFiles.find((file) => file.variant === "low");
	return high && low ? { high, low } : null;
}

function buildCivitaiImportInput(input: {
	activeVariant: LoraSourcePreviewVariant | null;
	importAsPair: boolean;
	preview: LoraSourcePreview | null;
	selectedVersionId: number | null;
	sourceUrl: string;
	workflowBaseModel?: string;
}) {
	const pair = getDetectedPair(input.preview);
	const wantsPair = Boolean(pair && input.importAsPair);
	const baseModel = resolveImportBaseModel(input);
	const sourceVersionId =
		input.activeVariant?.versionId ??
		input.selectedVersionId ??
		input.preview?.sourceVersionId;

	return {
		baseModel,
		defaultWeight: 1,
		description: input.preview?.description,
		name: input.preview?.name,
		pair:
			wantsPair && pair
				? {
						sourceUrl: pair.low.sourceUrl,
						sourceVersionId: pair.low.sourceVersionId,
						variant: "low" as const,
					}
				: undefined,
		sourceProvider: "civitai" as const,
		sourceUrl: wantsPair && pair ? pair.high.sourceUrl : input.sourceUrl,
		sourceVersionId:
			wantsPair && pair ? pair.high.sourceVersionId : sourceVersionId,
		variant: wantsPair ? ("high" as const) : undefined,
	};
}

function pickImportedEntry(
	entries: LoraRegistryEntry[],
	restrictVariant: LoraVariant | undefined
) {
	if (entries.length === 0) {
		return null;
	}
	if (!restrictVariant) {
		return entries[0] ?? null;
	}
	return (
		entries.find((entry) => entry.variant === restrictVariant) ??
		entries.find((entry) => entry.variant === "both" || !entry.variant) ??
		entries[0] ??
		null
	);
}

function CivitaiPreviewDetails({
	activeVariant,
	onVersionChange,
	preview,
	selectedVersionId,
}: {
	activeVariant: LoraSourcePreviewVariant | null;
	onVersionChange: (versionId: number) => void;
	preview: LoraSourcePreview;
	selectedVersionId: number | null;
}) {
	const previewName = preview.name ?? "Civitai LoRA";
	const previewVersion = activeVariant?.versionName ?? preview.versionName;
	const previewFile = activeVariant?.fileName ?? preview.fileName;
	const previewWords = activeVariant?.trainedWords ?? preview.trainedWords;

	return (
		<div className="grid gap-1.5 rounded-lg bg-foreground/[0.03] px-2.5 py-2">
			<div className="grid min-w-0 gap-0.5">
				<p className="truncate font-medium text-[11px]">{previewName}</p>
				<p className="truncate text-[10px] text-muted-foreground">
					{[previewVersion, previewFile].filter(Boolean).join(" / ")}
				</p>
			</div>
			{previewWords && previewWords.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{previewWords.slice(0, 4).map((word) => (
						<span
							className="rounded border border-foreground/10 px-1.5 py-0.5 text-[10px]"
							key={word}
						>
							{word}
						</span>
					))}
				</div>
			) : null}
			{preview.variants && preview.variants.length > 1 ? (
				<select
					aria-label="Civitai model version"
					className="h-7 rounded-md border border-foreground/10 bg-background px-2 text-[11px] outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
					onChange={(event) => onVersionChange(Number(event.target.value))}
					value={selectedVersionId ?? ""}
				>
					{preview.variants.map((variant) => (
						<option key={variant.versionId} value={variant.versionId}>
							{[variant.versionName, variant.baseModel, variant.fileName]
								.filter(Boolean)
								.join(" / ")}
						</option>
					))}
				</select>
			) : null}
		</div>
	);
}

function CivitaiPairToggle({
	checked,
	pair,
	setChecked,
}: {
	checked: boolean;
	pair: NonNullable<ReturnType<typeof getDetectedPair>>;
	setChecked: (checked: boolean) => void;
}) {
	return (
		<label className="flex items-start gap-2 rounded-lg bg-emerald-500/8 px-2.5 py-2 text-[10px] text-emerald-800 dark:text-emerald-200">
			<input
				checked={checked}
				className="mt-0.5"
				onChange={(event) => setChecked(event.target.checked)}
				type="checkbox"
			/>
			<span className="grid gap-0.5">
				<span className="font-medium">Import high+low pair</span>
				<span className="text-emerald-700/75 dark:text-emerald-300/75">
					{pair.high.fileName ?? "High"} / {pair.low.fileName ?? "Low"}
				</span>
			</span>
		</label>
	);
}

function getCivitaiSourceUrl(entry: LoraRegistryEntry) {
	if (!entry.sourceUrl) {
		return null;
	}
	if (entry.sourceProvider === "civitai") {
		return entry.sourceUrl;
	}
	try {
		const url = new URL(entry.sourceUrl);
		return civitaiHostPattern.test(url.hostname) ? entry.sourceUrl : null;
	} catch {
		return null;
	}
}

function CivitaiSourceLink({
	compact = false,
	entry,
}: {
	compact?: boolean;
	entry: LoraRegistryEntry;
}) {
	const sourceUrl = getCivitaiSourceUrl(entry);
	if (!sourceUrl) {
		return null;
	}

	const className = compact
		? "mt-1.5 mr-2 inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
		: "mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline";

	return (
		<a
			aria-label={`Open ${entry.name} on Civitai`}
			className={className}
			href={sourceUrl}
			rel="noopener noreferrer"
			target="_blank"
		>
			Civitai
			<ExternalLink aria-hidden="true" className="size-2.5" />
		</a>
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
					<CivitaiSourceLink entry={entry} />
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
	allowRepeatedBothNoiseLoras?: boolean;
	availableLoras: LoraRegistryEntry[];
	excludedUrls: Set<string>;
	onClose: () => void;
	onLorasImported?: (entries: LoraRegistryEntry[]) => void;
	onPickEntry: (
		entry: LoraRegistryEntry,
		peerEntries?: LoraRegistryEntry[]
	) => void;
	/**
	 * Restricts the picker to entries matching this variant. Used for wan 2.2
	 * workflows where each slot targets a specific transformer (high/low) and
	 * we want to surface only relevant LoRAs for the slot being filled.
	 */
	restrictVariant?: LoraVariant;
	workflowBaseModel?: string;
}

function CivitaiImportPanel({
	onImported,
	onLorasImported,
	restrictVariant,
	workflowBaseModel,
}: {
	onImported: (
		entry: LoraRegistryEntry,
		peerEntries?: LoraRegistryEntry[]
	) => void;
	onLorasImported?: (entries: LoraRegistryEntry[]) => void;
	restrictVariant?: LoraVariant;
	workflowBaseModel?: string;
}) {
	const [sourceUrl, setSourceUrl] = useState("");
	const [preview, setPreview] = useState<LoraSourcePreview | null>(null);
	const [selectedVersionId, setSelectedVersionId] = useState<number | null>(
		null
	);
	const [importAsPair, setImportAsPair] = useState(true);
	const [isPreviewing, setIsPreviewing] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const trimmedSourceUrl = sourceUrl.trim();
	const activeVariant = findPreviewVariant(preview, selectedVersionId);
	const canUseUrl = isCivitaiUrl(trimmedSourceUrl);
	const detectedPair = getDetectedPair(preview);

	async function loadPreview(options: { silent?: boolean } = {}) {
		if (!canUseUrl) {
			toast.error("Paste a Civitai URL first.");
			return null;
		}
		setIsPreviewing(true);
		try {
			const result = await previewStudioLoraSource({
				sourceUrl: trimmedSourceUrl,
				sourceVersionId: selectedVersionId ?? undefined,
			});
			setPreview(result);
			setSelectedVersionId(
				result.sourceVersionId ?? result.variants?.[0]?.versionId ?? null
			);
			if (!options.silent) {
				toast.success("Civitai preview loaded.");
			}
			return result;
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to preview LoRA."
			);
			return null;
		} finally {
			setIsPreviewing(false);
		}
	}

	async function handleImport() {
		if (!canUseUrl) {
			toast.error("Paste a Civitai URL first.");
			return;
		}
		setIsImporting(true);
		try {
			const previewForImport = preview ?? (await loadPreview({ silent: true }));
			if (!previewForImport) {
				return;
			}
			const activeVariantForImport = findPreviewVariant(
				previewForImport,
				selectedVersionId
			);
			const imported = await importStudioLoraFromUrl(
				buildCivitaiImportInput({
					activeVariant: activeVariantForImport,
					importAsPair,
					preview: previewForImport,
					selectedVersionId,
					sourceUrl: trimmedSourceUrl,
					workflowBaseModel,
				})
			);
			const selected = pickImportedEntry(imported, restrictVariant);
			if (!selected) {
				throw new Error("Server returned no LoRA records.");
			}
			onLorasImported?.(imported);
			onImported(selected, imported);
			toast.success(
				imported.length > 1
					? `Imported ${imported.length} LoRAs.`
					: `Imported ${selected.name}.`
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import LoRA."
			);
		} finally {
			setIsImporting(false);
		}
	}

	function handleVersionChange(versionId: number) {
		setSelectedVersionId(versionId);
		const variant = preview?.variants?.find(
			(item) => item.versionId === versionId
		);
		if (variant) {
			setPreview((current) =>
				current ? { ...current, sourceVersionId: variant.versionId } : current
			);
		}
	}

	const previewBaseModel =
		activeVariant?.baseModel ?? preview?.baseModel ?? workflowBaseModel;

	return (
		<div className="grid gap-2 border-foreground/8 border-t pt-2">
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium text-[11px]">Import Civitai</span>
				{previewBaseModel ? (
					<code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[9px] text-muted-foreground">
						{previewBaseModel}
					</code>
				) : null}
			</div>
			<div className="flex min-w-0 gap-1.5">
				<Input
					aria-label="Civitai LoRA URL"
					className="h-7 min-w-0 text-[11px]"
					onChange={(event) => {
						setSourceUrl(event.target.value);
						setPreview(null);
						setSelectedVersionId(null);
					}}
					placeholder="https://civitai.com/models/..."
					value={sourceUrl}
				/>
				<Button
					disabled={isPreviewing || isImporting}
					onClick={() => {
						loadPreview().catch(() => undefined);
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					{isPreviewing ? (
						<Loader2 className="size-3 animate-spin" />
					) : (
						<Eye className="size-3" />
					)}
					Preview
				</Button>
			</div>
			{preview ? (
				<CivitaiPreviewDetails
					activeVariant={activeVariant}
					onVersionChange={handleVersionChange}
					preview={preview}
					selectedVersionId={selectedVersionId}
				/>
			) : null}
			{detectedPair ? (
				<CivitaiPairToggle
					checked={importAsPair}
					pair={detectedPair}
					setChecked={setImportAsPair}
				/>
			) : null}
			<Button
				className="w-full"
				disabled={isPreviewing || isImporting || !canUseUrl}
				onClick={() => {
					handleImport().catch(() => undefined);
				}}
				size="sm"
				type="button"
			>
				{isImporting ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<Download className="size-3.5" />
				)}
				Import and use
			</Button>
		</div>
	);
}

function PickerPopover({
	adminHref,
	allowRepeatedBothNoiseLoras = false,
	availableLoras,
	excludedUrls,
	onClose,
	onLorasImported,
	onPickEntry,
	restrictVariant,
	workflowBaseModel,
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
			const canRepeatEntry =
				allowRepeatedBothNoiseLoras && canApplyToBothNoiseSlots(entry);
			if (excludedUrls.has(entry.s3Url) && !canRepeatEntry) {
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
	}, [
		allowRepeatedBothNoiseLoras,
		availableLoras,
		excludedUrls,
		query,
		restrictVariant,
	]);

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
						<li
							className="flex items-start rounded-lg transition hover:bg-foreground/[0.05]"
							key={entry.id}
						>
							<button
								className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
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
							<CivitaiSourceLink compact entry={entry} />
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
			<CivitaiImportPanel
				onImported={onPickEntry}
				onLorasImported={onLorasImported}
				restrictVariant={restrictVariant}
				workflowBaseModel={workflowBaseModel}
			/>
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
	allowRepeatedBothNoiseLoras,
	availableLoras,
	excludedUrls,
	isMultiSlot,
	onLorasImported,
	onPickEntry,
	openSlotKey,
	restrictVariant,
	setOpenSlotKey,
	slot,
	slotIndex,
	workflowBaseModel,
}: {
	adminHref: string;
	allowRepeatedBothNoiseLoras?: boolean;
	availableLoras: LoraRegistryEntry[];
	excludedUrls: Set<string>;
	isMultiSlot: boolean;
	onLorasImported?: (entries: LoraRegistryEntry[]) => void;
	onPickEntry: (
		entry: LoraRegistryEntry,
		slotIndex: number,
		peerEntries?: LoraRegistryEntry[]
	) => void;
	openSlotKey: string | null;
	restrictVariant?: LoraVariant;
	setOpenSlotKey: (key: string | null) => void;
	slot: ResolvedSlot;
	slotIndex: number;
	workflowBaseModel?: string;
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
					allowRepeatedBothNoiseLoras={allowRepeatedBothNoiseLoras}
					availableLoras={availableLoras}
					excludedUrls={excludedUrls}
					onClose={() => setOpenSlotKey(null)}
					onLorasImported={onLorasImported}
					onPickEntry={(entry, peerEntries) =>
						onPickEntry(entry, slotIndex, peerEntries)
					}
					restrictVariant={restrictVariant}
					workflowBaseModel={workflowBaseModel}
				/>
			) : null}
		</div>
	);
}

export default function LoraStack({
	adminHref,
	availableLoras,
	form,
	onLorasImported,
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

	function autoFillPaired(
		entry: LoraRegistryEntry,
		sourceSlotIndex: number,
		peerEntries: LoraRegistryEntry[] = availableLoras
	) {
		// Wan 2.2 LoRAs are imported as a high+low pair sharing a pairGroupId.
		// When the user picks one, find the matching variant and place it into
		// the opposite slot so they don't have to repeat the search.
		if (!(entry.pairGroupId && entry.variant) || entry.variant === "both") {
			return;
		}
		const paired = peerEntries.find(
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

	function fillBothNoiseSlots(entry: LoraRegistryEntry) {
		for (const [slotIndex, slot] of resolved.entries()) {
			if (!isNoiseSlot(slot)) {
				continue;
			}
			fillSlot(slotIndex, entry.s3Url, entry.defaultWeight);
		}
	}

	function handlePickEntryForSlot(
		entry: LoraRegistryEntry,
		slotIndex: number,
		peerEntries?: LoraRegistryEntry[]
	) {
		const slot = resolved[slotIndex];
		if (
			isMultiSlot &&
			slot &&
			isNoiseSlot(slot) &&
			canApplyToBothNoiseSlots(entry)
		) {
			fillBothNoiseSlots(entry);
			setOpenSlotKey(null);
			return;
		}
		fillSlot(slotIndex, entry.s3Url, entry.defaultWeight);
		autoFillPaired(entry, slotIndex, peerEntries);
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
		const slotVariant = getSlotVariant(slot);
		return (
			<LoraEmptySlotPickerRow
				adminHref={adminHref}
				allowRepeatedBothNoiseLoras={Boolean(slotVariant)}
				availableLoras={availableLoras}
				excludedUrls={excludedUrls}
				isMultiSlot={isMultiSlot}
				onLorasImported={onLorasImported}
				onPickEntry={handlePickEntryForSlot}
				openSlotKey={openSlotKey}
				restrictVariant={slotVariant}
				setOpenSlotKey={setOpenSlotKey}
				slot={slot}
				slotIndex={slotIndex}
				workflowBaseModel={workflow.baseModel}
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
