"use client";

import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import { Button } from "@generator/ui/components/button";
import { cn } from "@generator/ui/lib/utils";
import {
	ArrowLeft,
	CheckCircle2,
	Loader2,
	RefreshCw,
	Sparkles,
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
				typeof parsed.executionId === "string" &&
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
	execution: GeneratorExecutionRecord | null
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

export default function ReferenceVariantPicker() {
	const router = useRouter();
	const [draft, setDraft] = useState<PersonReferenceDraft | null>(null);
	const [isHydrated, setIsHydrated] = useState(false);
	const [execution, setExecution] = useState<GeneratorExecutionRecord | null>(
		null
	);
	const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [isRegenerating, setIsRegenerating] = useState(false);
	const [pollError, setPollError] = useState<string | null>(null);
	const inFlightExecutionId = useRef<string | null>(null);

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

	useEffect(() => {
		if (!draft) {
			return;
		}
		const targetExecutionId = draft.executionId;
		let cancelled = false;
		inFlightExecutionId.current = targetExecutionId;

		async function poll() {
			try {
				const next = await getAvatarPreview(targetExecutionId);
				if (cancelled || inFlightExecutionId.current !== targetExecutionId) {
					return;
				}
				setExecution(next);
				setPollError(null);
				if (next.status === "succeeded" || next.status === "failed") {
					return;
				}
				timerId = window.setTimeout(poll, POLL_INTERVAL_MS);
			} catch (error) {
				if (cancelled) {
					return;
				}
				setPollError(
					error instanceof Error ? error.message : "Failed to fetch preview"
				);
				timerId = window.setTimeout(poll, POLL_INTERVAL_MS);
			}
		}

		let timerId = window.setTimeout(poll, 0);
		return () => {
			cancelled = true;
			window.clearTimeout(timerId);
		};
	}, [draft]);

	const variants = extractArtifactUrls(execution);
	const status = execution?.status ?? "queued";
	const progressPct = getExecutionProgressPct(execution);
	const isReady = status === "succeeded" && variants.length > 0;
	const hasFailed = status === "failed";

	useEffect(() => {
		if (!isReady) {
			return;
		}
		setSelectedUrl((current) => {
			if (current && variants.includes(current)) {
				return current;
			}
			return variants[0] ?? null;
		});
	}, [isReady, variants]);

	const handleRegenerate = useCallback(async () => {
		if (!draft || isRegenerating) {
			return;
		}
		setIsRegenerating(true);
		try {
			const next = await requestAvatarPreviews({
				prompt: draft.prompt,
				count: 4,
			});
			const nextDraft: PersonReferenceDraft = {
				...draft,
				executionId: next.id,
			};
			writeDraft(nextDraft);
			setExecution(null);
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

	const handleConfirm = useCallback(async () => {
		if (!(draft && selectedUrl) || isCreating) {
			return;
		}
		setIsCreating(true);
		try {
			const nextPerson = await createPerson({
				...draft.form,
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
	}, [draft, selectedUrl, isCreating, router]);

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

	return (
		<main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6 sm:py-12">
			<header className="grid gap-2">
				<button
					className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-xs transition hover:text-foreground"
					onClick={handleCancel}
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
						<h1 className="font-medium text-2xl tracking-tight">
							Pick a reference photo
						</h1>
						<p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
							We generated a few options based on your description. Choose one
							to use as the reference for the LoRA training pipeline.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							disabled={isRegenerating || !(isReady || hasFailed)}
							onClick={handleRegenerate}
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
							onClick={handleConfirm}
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
				</div>
				<p className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
					<span className="font-medium text-foreground/80">Prompt: </span>
					{draft.prompt}
				</p>
			</header>

			{pollError ? (
				<div className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-300">
					Preview status check failed: {pollError}. Retrying…
				</div>
			) : null}

			{hasFailed ? (
				<div className="grid gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
					<div className="flex items-center gap-2 text-rose-700 text-sm dark:text-rose-300">
						<RefreshCw className="size-4" />
						Generation failed
					</div>
					{execution?.errorSummary ? (
						<p className="text-muted-foreground text-xs">
							{execution.errorSummary}
						</p>
					) : null}
					<Button onClick={handleRegenerate} size="sm" variant="outline">
						<RefreshCw className="size-3.5" />
						Try again
					</Button>
				</div>
			) : null}

			{isReady || hasFailed ? null : (
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
			)}

			{isReady ? (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{variants.map((url, index) => {
						const isSelected = selectedUrl === url;
						return (
							<button
								aria-label={`Use variant ${index + 1}`}
								aria-pressed={isSelected}
								className={cn(
									"group relative aspect-[3/4] overflow-hidden rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									isSelected
										? "border-foreground shadow-black/10 shadow-lg"
										: "border-border/40 hover:border-border"
								)}
								key={url}
								onClick={() => setSelectedUrl(url)}
								type="button"
							>
								<Image
									alt={`Variant ${index + 1}`}
									className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
									fill
									sizes="(max-width: 640px) 50vw, 25vw"
									src={url}
									unoptimized
								/>
								{isSelected ? (
									<div className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-foreground text-background shadow-sm">
										<CheckCircle2 className="size-4" />
									</div>
								) : null}
							</button>
						);
					})}
				</div>
			) : null}
		</main>
	);
}
