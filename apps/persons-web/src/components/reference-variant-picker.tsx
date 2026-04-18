"use client";

import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import { Button } from "@generator/ui/components/button";
import { InfoTooltip } from "@generator/ui/components/info-tooltip";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import {
	ArrowLeft,
	CheckCircle2,
	Loader2,
	RefreshCw,
	Sparkles,
	Wand2,
} from "lucide-react";
import type { Route } from "next";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
	PERSON_REFERENCE_DRAFT_STORAGE_KEY,
	type PersonReferenceDraft,
} from "@/components/persons-workspace";
import {
	createPerson,
	getAvatarPreview,
	refineAvatarPreviews,
	requestAvatarPreviews,
	trainPersonLora,
} from "@/lib/persons-api";

const POLL_INTERVAL_MS = 3000;
const SKELETON_KEYS = [
	"variant-skeleton-1",
	"variant-skeleton-2",
	"variant-skeleton-3",
	"variant-skeleton-4",
] as const;

type ExecutionMap = Record<string, GeneratorExecutionRecord>;

function readDraft(): PersonReferenceDraft | null {
	if (typeof window === "undefined") {
		return null;
	}
	const raw = window.sessionStorage.getItem(PERSON_REFERENCE_DRAFT_STORAGE_KEY);
	if (!raw) {
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as PersonReferenceDraft;
		if (
			!(
				parsed &&
				Array.isArray(parsed.executionIds) &&
				parsed.executionIds.every((id) => typeof id === "string") &&
				parsed.executionIds.length > 0 &&
				typeof parsed.prompt === "string" &&
				parsed.form &&
				typeof parsed.form.name === "string"
			)
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function writeDraft(draft: PersonReferenceDraft) {
	if (typeof window === "undefined") {
		return;
	}
	window.sessionStorage.setItem(
		PERSON_REFERENCE_DRAFT_STORAGE_KEY,
		JSON.stringify(draft)
	);
}

function clearDraft() {
	if (typeof window === "undefined") {
		return;
	}
	window.sessionStorage.removeItem(PERSON_REFERENCE_DRAFT_STORAGE_KEY);
}

function getExecutionProgressPct(execution: GeneratorExecutionRecord | null) {
	if (!execution) {
		return 0;
	}
	if (typeof execution.progressPct === "number") {
		return Math.max(0, Math.min(100, Math.round(execution.progressPct)));
	}
	switch (execution.status) {
		case "queued":
			return 5;
		case "running":
			return 65;
		case "succeeded":
		case "failed":
			return 100;
		default:
			return 0;
	}
}

function extractArtifactUrls(
	execution: GeneratorExecutionRecord | null | undefined
): string[] {
	if (!execution) {
		return [];
	}
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const artifact of execution.artifacts) {
		const url = artifact.url;
		if (typeof url === "string" && url.length > 0 && !seen.has(url)) {
			seen.add(url);
			urls.push(url);
		}
	}
	return urls;
}

interface VariantItem {
	executionId: string;
	prompt?: string;
	url: string;
}

function buildVariants(
	executionIds: string[],
	executions: ExecutionMap,
	prompts: string[]
): VariantItem[] {
	const items: VariantItem[] = [];
	const seen = new Set<string>();
	executionIds.forEach((executionId, index) => {
		const execution = executions[executionId];
		const urls = extractArtifactUrls(execution);
		for (const url of urls) {
			if (seen.has(url)) {
				continue;
			}
			seen.add(url);
			items.push({
				executionId,
				prompt: prompts[index],
				url,
			});
		}
	});
	return items;
}

function aggregateStatus(
	executionIds: string[],
	executions: ExecutionMap
): {
	allTerminal: boolean;
	hasFailed: boolean;
	progressPct: number;
	someSucceeded: boolean;
} {
	if (executionIds.length === 0) {
		return {
			allTerminal: false,
			hasFailed: false,
			progressPct: 0,
			someSucceeded: false,
		};
	}
	let totalPct = 0;
	let allTerminal = true;
	let hasFailed = false;
	let someSucceeded = false;
	for (const id of executionIds) {
		const execution = executions[id] ?? null;
		totalPct += getExecutionProgressPct(execution);
		const status = execution?.status;
		if (status !== "succeeded" && status !== "failed") {
			allTerminal = false;
		}
		if (status === "failed") {
			hasFailed = true;
		}
		if (status === "succeeded") {
			someSucceeded = true;
		}
	}
	return {
		allTerminal,
		hasFailed,
		progressPct: Math.round(totalPct / executionIds.length),
		someSucceeded,
	};
}

function RefinePanel({
	instruction,
	isDisabled,
	isRefining,
	onChangeInstruction,
	onRefine,
	selectedVariant,
}: {
	instruction: string;
	isDisabled: boolean;
	isRefining: boolean;
	onChangeInstruction: (value: string) => void;
	onRefine: () => void;
	selectedVariant: VariantItem | null;
}) {
	const canSubmit =
		!isDisabled && Boolean(selectedVariant) && instruction.trim().length > 0;
	const helperText = selectedVariant
		? "Grok сравнит исходный промт выбранного фото с вашими правками и перегенерирует вариант на основе этой картинки."
		: "Сначала выберите фото, которое хотите доработать.";

	return (
		<section className="grid gap-2 rounded-2xl border border-border/40 bg-muted/10 p-4 dark:bg-muted/5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2 text-sm">
					<Wand2 className="size-4 text-violet-500" />
					<span className="font-medium">Refine with Grok</span>
				</div>
				{selectedVariant?.prompt ? (
					<InfoTooltip
						contentClassName="max-w-md"
						label="Show selected variant prompt"
						side="bottom"
					>
						{selectedVariant.prompt}
					</InfoTooltip>
				) : null}
			</div>
			<p className="text-muted-foreground text-xs leading-relaxed">
				{helperText}
			</p>
			<textarea
				className="flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
				disabled={isDisabled || !selectedVariant}
				onChange={(event) => onChangeInstruction(event.target.value)}
				placeholder="Например: смени локацию на пляж на закате, добавь льняное платье цвета слоновой кости, длинные распущенные волосы…"
				value={instruction}
			/>
			<div className="flex justify-end">
				<Button
					disabled={!canSubmit}
					onClick={onRefine}
					size="sm"
					variant="outline"
				>
					{isRefining ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Wand2 className="size-3.5" />
					)}
					Refine selected
				</Button>
			</div>
		</section>
	);
}

function HeaderActions({
	hasFailedAll,
	isCreating,
	isReady,
	isRegenerating,
	onConfirm,
	onRegenerate,
	selectedUrl,
}: {
	hasFailedAll: boolean;
	isCreating: boolean;
	isReady: boolean;
	isRegenerating: boolean;
	onConfirm: () => void;
	onRegenerate: () => void;
	selectedUrl: string | null;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button
				disabled={isRegenerating || !(isReady || hasFailedAll)}
				onClick={onRegenerate}
				size="sm"
				variant="outline"
			>
				{isRegenerating ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<RefreshCw className="size-3.5" />
				)}
				Regenerate
			</Button>
			<Button
				disabled={!(isReady && selectedUrl) || isCreating}
				onClick={onConfirm}
				size="sm"
			>
				{isCreating ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<Sparkles className="size-3.5" />
				)}
				Use this reference
			</Button>
		</div>
	);
}

function FailedNotice({
	errorSummary,
	onRetry,
}: {
	errorSummary?: string;
	onRetry: () => void;
}) {
	return (
		<div className="grid gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
			<div className="flex items-center gap-2 text-rose-700 text-sm dark:text-rose-300">
				<RefreshCw className="size-4" />
				Generation failed
			</div>
			{errorSummary ? (
				<p className="text-muted-foreground text-xs">{errorSummary}</p>
			) : null}
			<Button onClick={onRetry} size="sm" variant="outline">
				<RefreshCw className="size-3.5" />
				Try again
			</Button>
		</div>
	);
}

function ProgressPanel({ progressPct }: { progressPct: number }) {
	return (
		<div className="grid gap-4 rounded-2xl border border-border/40 bg-muted/10 p-6 dark:bg-muted/5">
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2 className="size-4 animate-spin" />
				Generating reference variants…
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30 dark:bg-muted/15">
				<div
					className="h-full rounded-full bg-sky-500/70 transition-[width] duration-500"
					style={{ width: `${progressPct}%` }}
				/>
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{SKELETON_KEYS.map((skeletonKey) => (
					<div
						className="aspect-[3/4] animate-pulse rounded-xl bg-muted/30 dark:bg-muted/10"
						key={skeletonKey}
					/>
				))}
			</div>
		</div>
	);
}

function VariantsGrid({
	onSelect,
	selectedUrl,
	variants,
}: {
	onSelect: (url: string) => void;
	selectedUrl: string | null;
	variants: VariantItem[];
}) {
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{variants.map((variant, index) => {
				const isSelected = selectedUrl === variant.url;
				const tooltipText = variant.prompt?.trim() || `Variant ${index + 1}`;
				return (
					<Tooltip key={variant.url}>
						<TooltipTrigger
							render={
								<button
									aria-label={`Use variant ${index + 1}`}
									aria-pressed={isSelected}
									className={cn(
										"group relative aspect-[3/4] overflow-hidden rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										isSelected
											? "border-foreground shadow-black/10 shadow-lg"
											: "border-border/40 hover:border-border"
									)}
									onClick={() => onSelect(variant.url)}
									type="button"
								/>
							}
						>
							<Image
								alt={`Variant ${index + 1}`}
								className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
								fill
								sizes="(max-width: 640px) 50vw, 25vw"
								src={variant.url}
								unoptimized
							/>
							{isSelected ? (
								<div className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow-sm">
									<CheckCircle2 className="size-4" />
								</div>
							) : null}
						</TooltipTrigger>
						<TooltipContent className="max-w-sm items-start text-left leading-relaxed">
							{tooltipText}
						</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}

function usePollExecutions(executionIds: string[] | null) {
	const [executions, setExecutions] = useState<ExecutionMap>({});
	const [pollError, setPollError] = useState<string | null>(null);
	const inFlightRef = useRef<string[] | null>(null);

	useEffect(() => {
		setExecutions({});
		setPollError(null);
	}, []);

	useEffect(() => {
		if (!executionIds || executionIds.length === 0) {
			return;
		}
		inFlightRef.current = executionIds;
		setExecutions({});
		setPollError(null);
		let cancelled = false;
		const timers = new Map<string, number>();

		const isCurrentBatch = () => inFlightRef.current === executionIds;

		const scheduleNext = (executionId: string) => {
			const timer = window.setTimeout(
				() => pollOne(executionId),
				POLL_INTERVAL_MS
			);
			timers.set(executionId, timer);
		};

		const pollOne = async (executionId: string) => {
			try {
				const next = await getAvatarPreview(executionId);
				if (cancelled || !isCurrentBatch()) {
					return;
				}
				setExecutions((prev) => ({ ...prev, [executionId]: next }));
				setPollError(null);
				if (next.status === "succeeded" || next.status === "failed") {
					return;
				}
				scheduleNext(executionId);
			} catch (error) {
				if (cancelled || !isCurrentBatch()) {
					return;
				}
				setPollError(
					error instanceof Error ? error.message : "Failed to fetch preview"
				);
				scheduleNext(executionId);
			}
		};

		for (const executionId of executionIds) {
			const timer = window.setTimeout(() => pollOne(executionId), 0);
			timers.set(executionId, timer);
		}

		return () => {
			cancelled = true;
			for (const timer of timers.values()) {
				window.clearTimeout(timer);
			}
		};
	}, [executionIds]);

	return { executions, pollError };
}

function PageHeader({
	draft,
	hasFailedAll,
	isCreating,
	isReady,
	isRegenerating,
	onCancel,
	onConfirm,
	onRegenerate,
	selectedUrl,
}: {
	draft: PersonReferenceDraft;
	hasFailedAll: boolean;
	isCreating: boolean;
	isReady: boolean;
	isRegenerating: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	onRegenerate: () => void;
	selectedUrl: string | null;
}) {
	const referenceGuidance = draft.enhanced
		? "Grok обогатил промт и сгенерировал четыре разных образа. Выберите подходящий референс для пайплайна LoRA."
		: "We generated a few options based on your description. Choose one to use as the reference for the LoRA training pipeline.";
	const enhancedPrompts =
		draft.enhanced && draft.prompts && draft.prompts.length > 0
			? draft.prompts
			: null;

	return (
		<header className="grid gap-2">
			<button
				className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-xs transition hover:text-foreground"
				onClick={onCancel}
				type="button"
			>
				<ArrowLeft className="size-3.5" />
				Back to cast
			</button>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="grid gap-1">
					<span className="text-muted-foreground/50 text-xs uppercase tracking-wider">
						New person · {draft.form.name || "Untitled"}
					</span>
					<div className="flex items-center gap-2">
						<h1 className="font-medium text-2xl tracking-tight">
							Pick a reference photo
						</h1>
						<InfoTooltip label="Show reference guidance" side="right">
							{referenceGuidance}
						</InfoTooltip>
					</div>
				</div>
				<HeaderActions
					hasFailedAll={hasFailedAll}
					isCreating={isCreating}
					isReady={isReady}
					isRegenerating={isRegenerating}
					onConfirm={onConfirm}
					onRegenerate={onRegenerate}
					selectedUrl={selectedUrl}
				/>
			</div>
			<div className="flex w-fit items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-muted-foreground text-xs">
				<span className="font-medium text-foreground/80">Prompt</span>
				<InfoTooltip
					contentClassName="max-w-md"
					label="Show source prompt"
					side="bottom"
				>
					{draft.prompt}
				</InfoTooltip>
			</div>
			{enhancedPrompts ? (
				<details className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 text-muted-foreground text-xs">
					<summary className="cursor-pointer font-medium text-foreground/80">
						Grok variants ({enhancedPrompts.length})
					</summary>
					<ol className="mt-2 grid list-decimal gap-1 pl-4">
						{enhancedPrompts.map((prompt, index) => (
							<li key={`${index}-${prompt.slice(0, 16)}`}>{prompt}</li>
						))}
					</ol>
				</details>
			) : null}
		</header>
	);
}

function useConfirmHandler({
	draft,
	selectedUrl,
	variants,
}: {
	draft: PersonReferenceDraft | null;
	selectedUrl: string | null;
	variants: VariantItem[];
}) {
	const router = useRouter();
	const [isCreating, setIsCreating] = useState(false);

	const handleConfirm = useCallback(async () => {
		if (!(draft && selectedUrl) || isCreating) {
			return;
		}
		setIsCreating(true);
		try {
			const variant = variants.find((item) => item.url === selectedUrl);
			const description =
				variant?.prompt && variant.prompt.length > 0
					? variant.prompt
					: draft.form.description;
			const nextPerson = await createPerson({
				...draft.form,
				description,
				referencePhotoUrl: selectedUrl,
			});
			toast.success("Person created");
			clearDraft();

			try {
				await trainPersonLora(nextPerson.id);
				toast.success("LoRA pipeline started");
			} catch {
				toast.info(
					"Person created. Start the pipeline manually from the detail view."
				);
			}

			router.push(`/person/${nextPerson.slug}` as Route);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to create person"
			);
			setIsCreating(false);
		}
	}, [draft, isCreating, router, selectedUrl, variants]);

	return { handleConfirm, isCreating };
}

function useRefineHandler({
	draft,
	instruction,
	onSuccess,
	selectedUrl,
	variants,
}: {
	draft: PersonReferenceDraft | null;
	instruction: string;
	onSuccess: (nextDraft: PersonReferenceDraft) => void;
	selectedUrl: string | null;
	variants: VariantItem[];
}) {
	const [isRefining, setIsRefining] = useState(false);

	const handleRefine = useCallback(async () => {
		if (!draft || isRefining) {
			return;
		}
		const variant = variants.find((item) => item.url === selectedUrl);
		const trimmedInstruction = instruction.trim();
		if (!(variant && trimmedInstruction)) {
			return;
		}
		const sourcePrompt = variant.prompt?.trim() || draft.prompt;
		setIsRefining(true);
		try {
			const next = await refineAvatarPreviews({
				sourcePrompt,
				sourceImageUrl: variant.url,
				instruction: trimmedInstruction,
				count: 4,
			});
			onSuccess({
				...draft,
				enhanced: true,
				executionIds: next.executions.map((execution) => execution.id),
				prompts: next.prompts,
			});
			toast.success("Refining variant with Grok");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to refine variant"
			);
		} finally {
			setIsRefining(false);
		}
	}, [draft, instruction, isRefining, onSuccess, selectedUrl, variants]);

	return { handleRefine, isRefining };
}

export default function ReferenceVariantPicker() {
	const router = useRouter();
	const [draft, setDraft] = useState<PersonReferenceDraft | null>(null);
	const [isHydrated, setIsHydrated] = useState(false);
	const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
	const [isRegenerating, setIsRegenerating] = useState(false);
	const [refineInstruction, setRefineInstruction] = useState("");

	useEffect(() => {
		setIsHydrated(true);
		const stored = readDraft();
		if (!stored) {
			toast.error("No avatar preview in progress. Start over.");
			router.replace("/" as Route);
			return;
		}
		setDraft(stored);
	}, [router]);

	const { executions, pollError } = usePollExecutions(
		draft?.executionIds ?? null
	);

	const variants = draft
		? buildVariants(draft.executionIds, executions, draft.prompts ?? [])
		: [];
	const aggregate = draft
		? aggregateStatus(draft.executionIds, executions)
		: {
				allTerminal: false,
				hasFailed: false,
				progressPct: 0,
				someSucceeded: false,
			};
	const isReady = aggregate.allTerminal && variants.length > 0;
	const hasFailedAll = aggregate.hasFailed && !aggregate.someSucceeded;

	useEffect(() => {
		if (variants.length === 0) {
			return;
		}
		setSelectedUrl((current) => {
			if (current && variants.some((variant) => variant.url === current)) {
				return current;
			}
			return variants[0]?.url ?? null;
		});
	}, [variants]);

	const handleRefineSuccess = useCallback((nextDraft: PersonReferenceDraft) => {
		writeDraft(nextDraft);
		setSelectedUrl(null);
		setDraft(nextDraft);
		setRefineInstruction("");
	}, []);

	const { handleRefine, isRefining } = useRefineHandler({
		draft,
		instruction: refineInstruction,
		onSuccess: handleRefineSuccess,
		selectedUrl,
		variants,
	});

	const handleRegenerate = useCallback(async () => {
		if (!draft || isRegenerating) {
			return;
		}
		setIsRegenerating(true);
		try {
			const next = await requestAvatarPreviews({
				prompt: draft.prompt,
				count: 4,
				enhance: draft.enhanced,
			});
			const nextDraft: PersonReferenceDraft = {
				...draft,
				enhanced: next.enhanced,
				executionIds: next.executions.map((execution) => execution.id),
				prompts: next.prompts,
			};
			writeDraft(nextDraft);
			setSelectedUrl(null);
			setDraft(nextDraft);
			toast.success("Generating new variants");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to start preview"
			);
		} finally {
			setIsRegenerating(false);
		}
	}, [draft, isRegenerating]);

	const { handleConfirm, isCreating } = useConfirmHandler({
		draft,
		selectedUrl,
		variants,
	});

	const handleCancel = useCallback(() => {
		clearDraft();
		router.push("/" as Route);
	}, [router]);

	if (!(isHydrated && draft)) {
		return (
			<main className="grid min-h-svh place-items-center px-4 py-10">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</main>
		);
	}

	const failedExecution = draft.executionIds
		.map((id) => executions[id])
		.find((execution) => execution?.status === "failed");

	return (
		<main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6 sm:py-12">
			<PageHeader
				draft={draft}
				hasFailedAll={hasFailedAll}
				isCreating={isCreating}
				isReady={isReady}
				isRegenerating={isRegenerating}
				onCancel={handleCancel}
				onConfirm={handleConfirm}
				onRegenerate={handleRegenerate}
				selectedUrl={selectedUrl}
			/>

			{pollError ? (
				<div className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-300">
					Preview status check failed: {pollError}. Retrying…
				</div>
			) : null}

			{hasFailedAll ? (
				<FailedNotice
					errorSummary={failedExecution?.errorSummary ?? undefined}
					onRetry={handleRegenerate}
				/>
			) : null}

			{isReady || hasFailedAll ? null : (
				<ProgressPanel progressPct={aggregate.progressPct} />
			)}

			{variants.length > 0 ? (
				<VariantsGrid
					onSelect={setSelectedUrl}
					selectedUrl={selectedUrl}
					variants={variants}
				/>
			) : null}

			{isReady && variants.length > 0 ? (
				<RefinePanel
					instruction={refineInstruction}
					isDisabled={isRegenerating || isCreating}
					isRefining={isRefining}
					onChangeInstruction={setRefineInstruction}
					onRefine={handleRefine}
					selectedVariant={
						variants.find((variant) => variant.url === selectedUrl) ?? null
					}
				/>
			) : null}
		</main>
	);
}
