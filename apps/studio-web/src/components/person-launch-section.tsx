"use client";

import type {
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";
import { enhanceStudioPrompt } from "@generator/studio-client/client";
import { Button } from "@generator/ui/components/button";
import { EnhancePromptButton } from "@generator/ui/components/enhance-prompt-button";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";
import { Loader2, Sparkles, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { generatePersonWithLora, getPersonById } from "@/lib/persons-api";

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

function isDatasetGeneration(generation: PersonGenerationRecord) {
	return generation.metadata?.isDatasetPhoto === true;
}

export interface PersonLaunchSectionProps {
	onPersonRefreshed: (person: PersonRecord) => void;
	person: PersonRecord;
}

export default function PersonLaunchSection({
	onPersonRefreshed,
	person,
}: PersonLaunchSectionProps) {
	const [prompt, setPrompt] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);
	const [pollAttempts, setPollAttempts] = useState(0);
	const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (pollTimeoutRef.current) {
				clearTimeout(pollTimeoutRef.current);
			}
		},
		[]
	);

	const hasLora = Boolean(person.loraUrl);
	const thumb = person.photoUrl ?? person.referencePhotoUrl ?? null;

	function stopPolling() {
		if (pollTimeoutRef.current) {
			clearTimeout(pollTimeoutRef.current);
			pollTimeoutRef.current = null;
		}
		setIsGenerating(false);
		setPollAttempts(0);
	}

	async function pollForNewGeneration(
		personId: string,
		knownIds: Set<string>,
		attempt: number
	) {
		if (attempt > MAX_POLL_ATTEMPTS) {
			stopPolling();
			toast.message("Generation still running. Check back shortly.");
			return;
		}
		setPollAttempts(attempt);
		try {
			const fresh = await getPersonById(personId);
			onPersonRefreshed(fresh);
			const newReady = fresh.generations.find(
				(generation) =>
					!knownIds.has(generation.id) &&
					generation.status === "ready" &&
					!isDatasetGeneration(generation)
			);
			if (newReady) {
				stopPolling();
				toast.success("New generation ready.");
				return;
			}
		} catch {
			// keep polling — transient errors are common while job is queued
		}
		pollTimeoutRef.current = setTimeout(() => {
			pollForNewGeneration(personId, knownIds, attempt + 1).catch(
				() => undefined
			);
		}, POLL_INTERVAL_MS);
	}

	async function handleGenerate() {
		const trimmed = prompt.trim();
		if (!trimmed) {
			toast.error("Add a prompt for LoRA generation.");
			return;
		}
		if (!hasLora) {
			toast.error("This person has no trained LoRA yet.");
			return;
		}
		setIsGenerating(true);
		setPollAttempts(0);
		const knownIds = new Set(
			person.generations.map((generation) => generation.id)
		);
		try {
			const updated = await generatePersonWithLora(person.id, trimmed);
			onPersonRefreshed(updated);
			pollForNewGeneration(updated.id, knownIds, 1).catch(() => undefined);
		} catch (error) {
			stopPolling();
			toast.error(
				error instanceof Error
					? error.message
					: "Unable to start LoRA generation."
			);
		}
	}

	return (
		<section className="grid min-w-0 gap-2 border-foreground/6 border-b px-3 py-2.5 dark:border-foreground/10">
			<div className="flex items-center justify-between gap-2">
				<SectionLabel>Generate with LoRA</SectionLabel>
				<span
					className={cn(
						"rounded-full px-1.5 py-0.5 text-[10px]",
						hasLora
							? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
							: "bg-muted/15 text-muted-foreground"
					)}
				>
					{hasLora ? "LoRA ready" : "no LoRA yet"}
				</span>
			</div>

			<div className="flex items-center gap-2 rounded-lg bg-muted/8 p-2 dark:bg-muted/4">
				<span className="relative size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10">
					{thumb ? (
						<span
							aria-hidden="true"
							className="absolute inset-0 bg-center bg-cover"
							style={{ backgroundImage: `url("${thumb}")` }}
						/>
					) : (
						<UserRound className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
					)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-xs">{person.name}</p>
					<p className="truncate text-[10px] text-muted-foreground">
						{person.slug}
					</p>
				</div>
			</div>

			<div className="grid min-w-0 gap-1">
				<div className="flex items-center justify-between gap-2">
					<span className="text-[10px] text-muted-foreground uppercase tracking-wide">
						Prompt
					</span>
					<EnhancePromptButton
						className="h-6 px-2 text-[10px]"
						enhance={async (value) => {
							const result = await enhanceStudioPrompt(value);
							if (result.notice) {
								toast.warning(result.notice);
							} else {
								toast.success("Prompt enhanced");
							}
							return result.enhanced;
						}}
						label="Enhance"
						onEnhanced={(enhanced) => setPrompt(enhanced)}
						onError={(message) => toast.error(message)}
						prompt={prompt}
						tooltip="Rewrite this prompt with the configured AI provider"
					/>
				</div>
				<textarea
					className="min-h-16 w-full resize-y rounded-lg border border-input bg-background/45 px-2 py-1.5 text-[11px] leading-snug outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
					disabled={!hasLora || isGenerating}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder={
						hasLora
							? "Describe the new shot…"
							: "Train this person's LoRA in Cast first"
					}
					value={prompt}
				/>
				<p className="text-[10px] text-muted-foreground">
					New photo will appear in Activity below — pick any scenario afterwards
					to use it as input.
				</p>
			</div>

			<Button
				disabled={!hasLora || isGenerating || !prompt.trim()}
				onClick={() => {
					handleGenerate().catch(() => undefined);
				}}
				size="sm"
			>
				{isGenerating ? (
					<>
						<Loader2 className="size-3.5 animate-spin" />
						Polling… ({pollAttempts}/{MAX_POLL_ATTEMPTS})
					</>
				) : (
					<>
						<Sparkles className="size-3.5" />
						Generate
					</>
				)}
			</Button>
		</section>
	);
}
