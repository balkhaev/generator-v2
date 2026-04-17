"use client";

import {
	clampProgressPct,
	DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT,
	getPersonLoraReferenceImageCount,
	getPersonLoraReferenceImageTarget,
	getPersonLoraTrainingDisplayStatus,
	getPersonLoraTrainingPhaseLabel,
	getPersonLoraTrainingProgressPct,
	isActivePersonLoraTrainingStatus,
	type PersonLoraTrainingMeta,
	type PersonLoraTrainingStatus,
	readPersonLoraTrainingMeta,
} from "@generator/contracts/persons";
import { env } from "@generator/env/web";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { EnhancePromptButton } from "@generator/ui/components/enhance-prompt-button";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import WorkspaceShell, {
	WorkspacePane,
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import {
	ArrowLeft,
	ArrowUpRight,
	AudioLines,
	AudioWaveform,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clapperboard,
	CloudOff,
	FolderArchive,
	ImageIcon,
	Loader2,
	Save,
	Sparkles,
	Trash2,
	Upload,
	UsersRound,
	X,
} from "lucide-react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
	type CreatePersonInput,
	cancelGeneration,
	cancelPersonLoraTraining,
	createPerson,
	deleteGeneration,
	deletePerson,
	enhancePersonsPrompt,
	fetchLoras,
	generateWithLora,
	getPersonsDashboard,
	type LoraRegistryEntry,
	type PersonGenerationRecord,
	type PersonRecord,
	requestAvatarPreviews,
	trainPersonLora,
	type UpdatePersonInput,
	updatePerson,
} from "@/lib/persons-api";

const textareaClassName =
	"flex min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

const selectClassName =
	"flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

const LORA_OPTIMISTIC_GENERATION_PREFIX = "__optimistic:lora:";
const trailingSlashesPattern = /\/+$/u;
const DEFAULT_ADMIN_URL = "http://localhost:3001";
const adminBaseUrl = (env.NEXT_PUBLIC_ADMIN_URL ?? DEFAULT_ADMIN_URL).replace(
	trailingSlashesPattern,
	""
);
const adminLorasHref = `${adminBaseUrl}/loras`;

interface LightboxState {
	images: string[];
	index: number;
}

function Lightbox({
	images,
	index,
	onClose,
	onNavigate,
}: {
	images: string[];
	index: number;
	onClose: () => void;
	onNavigate: (index: number) => void;
}) {
	const backdropRef = useRef<HTMLDivElement>(null);

	const goPrev = useCallback(() => {
		if (index > 0) {
			onNavigate(index - 1);
		}
	}, [index, onNavigate]);

	const goNext = useCallback(() => {
		if (index < images.length - 1) {
			onNavigate(index + 1);
		}
	}, [index, images.length, onNavigate]);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
			if (e.key === "ArrowLeft") {
				goPrev();
			}
			if (e.key === "ArrowRight") {
				goNext();
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [onClose, goPrev, goNext]);

	useEffect(() => {
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = "";
		};
	}, []);

	const src = images[index];
	if (!src) {
		return null;
	}

	const hasMultiple = images.length > 1;

	return (
		<div
			aria-label="Image viewer"
			aria-modal="true"
			className="fade-in fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/80 backdrop-blur-sm duration-200"
			ref={backdropRef}
			role="dialog"
		>
			{/* Invisible backdrop button for click-outside-to-close */}
			<button
				aria-label="Close lightbox"
				className="absolute inset-0 cursor-default"
				onClick={onClose}
				tabIndex={-1}
				type="button"
			/>

			<button
				aria-label="Close"
				className="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/50 text-white/80 transition hover:bg-black/70 hover:text-white"
				onClick={onClose}
				type="button"
			>
				<X className="size-5" />
			</button>

			{hasMultiple && index > 0 ? (
				<button
					aria-label="Previous image"
					className="absolute left-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/50 text-white/80 transition hover:bg-black/70 hover:text-white"
					onClick={goPrev}
					type="button"
				>
					<ChevronLeft className="size-5" />
				</button>
			) : null}

			{hasMultiple && index < images.length - 1 ? (
				<button
					aria-label="Next image"
					className="absolute right-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/50 text-white/80 transition hover:bg-black/70 hover:text-white"
					onClick={goNext}
					type="button"
				>
					<ChevronRight className="size-5" />
				</button>
			) : null}

			<div className="pointer-events-none relative flex max-h-[90vh] max-w-[90vw] items-center justify-center">
				<Image
					alt=""
					className="!relative max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
					fill
					sizes="90vw"
					src={src}
					unoptimized
				/>
			</div>

			{hasMultiple ? (
				<div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1.5 text-white/70 text-xs tabular-nums">
					{index + 1} / {images.length}
				</div>
			) : null}
		</div>
	);
}

const emptyCaptionTrack = "data:text/vtt;charset=utf-8,WEBVTT";

const generationTone = {
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
} as const;

function getPersonHrefBySlug(personSlug: string) {
	return `/person/${personSlug}` as Route;
}

const CAST_HREF = "/" as Route;

function createEmptyFormState(): CreatePersonInput {
	return {
		name: "",
		description: "",
	};
}

interface PersonManagementFormState {
	datasetUrl: string;
	description: string;
	loraUrl: string;
	name: string;
	personId: string;
	photoUrl: string;
	referencePhotoUrl: string;
	slug: string;
	videoUrl: string;
	voiceWavUrl: string;
}

function createManagementFormState(
	person: PersonRecord
): PersonManagementFormState {
	return {
		datasetUrl: person.datasetUrl ?? "",
		description: person.description,
		loraUrl: person.loraUrl ?? "",
		name: person.name,
		personId: person.id,
		photoUrl: person.photoUrl ?? "",
		referencePhotoUrl: person.referencePhotoUrl,
		slug: person.slug,
		videoUrl: person.videoUrl ?? "",
		voiceWavUrl: person.voiceWavUrl ?? "",
	};
}

function optionalUrlPayload(value: string) {
	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : null;
}

function createUpdatePersonPayload(
	formState: PersonManagementFormState
): UpdatePersonInput {
	return {
		datasetUrl: optionalUrlPayload(formState.datasetUrl),
		description: formState.description.trim(),
		loraUrl: optionalUrlPayload(formState.loraUrl),
		name: formState.name.trim(),
		photoUrl: optionalUrlPayload(formState.photoUrl),
		referencePhotoUrl: formState.referencePhotoUrl.trim(),
		slug: formState.slug.trim(),
		videoUrl: optionalUrlPayload(formState.videoUrl),
		voiceWavUrl: optionalUrlPayload(formState.voiceWavUrl),
	};
}

function getGenerationProgressPct(generation: PersonGenerationRecord) {
	const metadataProgressPct = generation.metadata.progressPct;
	if (typeof metadataProgressPct === "number") {
		return clampProgressPct(metadataProgressPct);
	}

	switch (generation.status) {
		case "queued":
			return 2;
		case "ready":
		case "failed":
			return 100;
		default:
			return 0;
	}
}

function isOptimisticLoraGeneration(generation: PersonGenerationRecord) {
	return generation.id.startsWith(LORA_OPTIMISTIC_GENERATION_PREFIX);
}

function createOptimisticLoraGeneration(
	personId: string,
	prompt: string
): PersonGenerationRecord {
	const now = new Date().toISOString();
	const suffix =
		typeof globalThis.crypto !== "undefined" &&
		typeof globalThis.crypto.randomUUID === "function"
			? globalThis.crypto.randomUUID()
			: String(Date.now());
	return {
		createdAt: now,
		errorSummary: null,
		id: `${LORA_OPTIMISTIC_GENERATION_PREFIX}${suffix}`,
		mediaType: "image",
		metadata: {},
		operatorRunId: null,
		operatorScenarioId: null,
		personId,
		previewUrl: null,
		prompt,
		sourceUrl: "",
		status: "queued",
		title: "Generating with LoRA",
		updatedAt: now,
	};
}

function GenerationPreview({
	generation,
	onImageClick,
}: {
	generation: PersonGenerationRecord;
	onImageClick?: () => void;
}) {
	if (generation.status === "queued") {
		const progressPct = getGenerationProgressPct(generation);

		return (
			<div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-muted/10 px-5 dark:bg-muted/5">
				<div className="flex w-full max-w-44 flex-col items-stretch gap-2.5">
					<div className="flex justify-center">
						<Loader2 className="size-6 animate-spin text-muted-foreground/50" />
					</div>
					<div className="flex w-full items-center justify-between gap-3 text-muted-foreground/60 text-xs">
						<span>Generating</span>
						<span className="font-medium tabular-nums">{progressPct}%</span>
					</div>
					<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30 dark:bg-muted/15">
						<div
							className="h-full rounded-full bg-sky-500/70 transition-[width] duration-500"
							style={{ width: `${progressPct}%` }}
						/>
					</div>
				</div>
			</div>
		);
	}

	if (generation.mediaType === "image") {
		const src = generation.previewUrl ?? generation.sourceUrl;
		return (
			<button
				aria-label={`View ${generation.title}`}
				className="relative w-full overflow-hidden rounded-lg bg-muted/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={onImageClick}
				type="button"
			>
				<div className="relative aspect-auto min-h-32">
					<Image
						alt={generation.title}
						className="!relative !h-auto !w-full object-contain"
						fill
						onLoad={(e) => {
							const img = e.currentTarget;
							const parent = img.parentElement;
							if (parent && img.naturalWidth && img.naturalHeight) {
								parent.style.aspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
							}
						}}
						sizes="(max-width: 768px) 100vw, 25vw"
						src={src}
					/>
				</div>
			</button>
		);
	}

	if (generation.mediaType === "audio") {
		return (
			<div className="flex min-h-24 items-center justify-center rounded-lg bg-muted/10 px-4 dark:bg-muted/5">
				<audio className="w-full" controls src={generation.sourceUrl}>
					<track
						default
						kind="captions"
						label="Captions unavailable"
						src={emptyCaptionTrack}
						srcLang="en"
					/>
				</audio>
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg">
			<video
				className="aspect-video w-full object-contain"
				controls
				src={generation.sourceUrl}
			>
				<track
					default
					kind="captions"
					label="Captions unavailable"
					src={emptyCaptionTrack}
					srcLang="en"
				/>
			</video>
		</div>
	);
}

function GenerationStatusIcon({
	status,
}: {
	status: PersonGenerationRecord["status"];
}) {
	if (status === "ready") {
		return <CheckCircle2 className="size-3.5" />;
	}

	if (status === "queued") {
		return <Loader2 className="size-3.5 animate-spin" />;
	}

	return <CloudOff className="size-3.5" />;
}

function GenerationMediaBadge({
	mediaType,
}: {
	mediaType: PersonGenerationRecord["mediaType"];
}) {
	if (mediaType === "audio") {
		return (
			<>
				<AudioLines className="mr-1 inline size-3" />
				{mediaType}
			</>
		);
	}

	if (mediaType === "image") {
		return (
			<>
				<ImageIcon className="mr-1 inline size-3" />
				{mediaType}
			</>
		);
	}

	return (
		<>
			<Clapperboard className="mr-1 inline size-3" />
			{mediaType}
		</>
	);
}

function PersonCard({
	getHref,
	person,
}: {
	getHref: (slug: string) => Route;
	person: PersonRecord;
}) {
	const training = readPersonLoraTrainingMeta(person);
	const status = getPersonLoraTrainingDisplayStatus(
		training,
		Boolean(person.loraUrl)
	);
	const isTraining = isActivePersonLoraTrainingStatus(status);
	const progressPct = getPersonLoraTrainingProgressPct(
		training,
		Boolean(person.loraUrl)
	);
	const showTrainingBadge = isTraining || status === "failed";

	return (
		<Link
			className="group relative overflow-hidden rounded-2xl bg-background/60 ring-1 ring-border/30 transition-all hover:shadow-black/5 hover:shadow-xl hover:ring-border/60 dark:bg-background/40 dark:hover:shadow-black/20"
			href={getHref(person.slug)}
		>
			<div className="relative aspect-[3/4] overflow-hidden">
				<Image
					alt={person.name}
					className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
					fill
					sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
					src={person.referencePhotoUrl}
				/>
				<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent pt-20 pr-4 pb-4 pl-4">
					<h3 className="font-semibold text-base text-white tracking-tight">
						{person.name}
					</h3>
					{person.description ? (
						<p className="mt-0.5 line-clamp-1 text-white/60 text-xs">
							{person.description}
						</p>
					) : null}
				</div>
			</div>
			<div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
				<span className="min-w-0 truncate text-muted-foreground/60 text-xs tabular-nums">
					{person.generations.length} generation
					{person.generations.length === 1 ? "" : "s"}
				</span>
				{showTrainingBadge && status ? (
					<span
						className={cn(
							"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px]",
							trainingStatusTone[status]
						)}
					>
						{isTraining ? <Loader2 className="size-3 animate-spin" /> : null}
						{status}
						{isTraining ? (
							<span className="tabular-nums">{progressPct}%</span>
						) : null}
					</span>
				) : null}
			</div>
		</Link>
	);
}

function CastGrid({
	getHref,
	persons,
}: {
	getHref: (slug: string) => Route;
	persons: PersonRecord[];
}) {
	if (persons.length === 0) {
		return (
			<EmptyState
				className="h-full"
				hint="Use the form on the right to create your first person."
				icon={UsersRound}
				message="No persons in the cast yet."
			/>
		);
	}

	return (
		<div className="grid min-h-0 content-start gap-4 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
			{persons.map((person) => (
				<PersonCard getHref={getHref} key={person.id} person={person} />
			))}
		</div>
	);
}

function buildStudioGenerationHref(
	studioUrl: string,
	generation: PersonGenerationRecord
) {
	if (!(generation.operatorRunId || generation.operatorScenarioId)) {
		return null;
	}

	const url = new URL(studioUrl);
	url.searchParams.set("tab", "runs");

	if (generation.operatorScenarioId) {
		url.searchParams.set("scenario", generation.operatorScenarioId);
	}

	if (generation.operatorRunId) {
		url.searchParams.set("run", generation.operatorRunId);
	}

	return url.toString();
}

function GenerationCard({
	generation,
	isCancelling,
	isDeleting,
	onCancel,
	onDelete,
	studioUrl,
	onImageClick,
}: {
	generation: PersonGenerationRecord;
	isCancelling: boolean;
	isDeleting: boolean;
	onCancel: () => void;
	onDelete: () => void;
	studioUrl: string;
	onImageClick?: () => void;
}) {
	const studioGenerationHref = buildStudioGenerationHref(studioUrl, generation);
	const optimistic = isOptimisticLoraGeneration(generation);
	const canCancel = generation.status === "queued" && !optimistic;

	return (
		<div className="grid gap-2 overflow-hidden rounded-xl border border-border/30 bg-background/60 dark:bg-background/40">
			<GenerationPreview generation={generation} onImageClick={onImageClick} />
			<div className="grid gap-1.5 px-3 pb-3">
				<div className="flex items-center justify-between gap-2">
					<h3 className="truncate font-medium text-sm">{generation.title}</h3>
					<div className="flex shrink-0 items-center gap-1.5">
						<span
							className={cn(
								"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
								generationTone[generation.status]
							)}
						>
							<GenerationStatusIcon status={generation.status} />
							{generation.status}
						</span>
						{canCancel ? (
							<button
								aria-label={`Cancel ${generation.title}`}
								className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground/50 transition hover:bg-amber-500/10 hover:text-amber-600 disabled:pointer-events-none disabled:opacity-50 dark:hover:text-amber-400"
								disabled={isCancelling || isDeleting || optimistic}
								onClick={onCancel}
								type="button"
							>
								{isCancelling ? (
									<Loader2 className="size-3 animate-spin" />
								) : (
									<X className="size-3" />
								)}
							</button>
						) : null}
						<button
							aria-label={`Delete ${generation.title}`}
							className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground/50 transition hover:bg-rose-500/10 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-50 dark:hover:text-rose-400"
							disabled={isDeleting || isCancelling || optimistic}
							onClick={onDelete}
							type="button"
						>
							{isDeleting ? (
								<Loader2 className="size-3 animate-spin" />
							) : (
								<Trash2 className="size-3" />
							)}
						</button>
					</div>
				</div>
				{generation.prompt ? (
					<p className="line-clamp-2 text-muted-foreground/70 text-xs leading-relaxed">
						{generation.prompt}
					</p>
				) : null}
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="inline-flex items-center text-[11px] text-muted-foreground/50">
						<GenerationMediaBadge mediaType={generation.mediaType} />
					</span>
					{studioGenerationHref ? (
						<a
							className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/50 transition hover:text-foreground"
							href={studioGenerationHref}
						>
							Studio
							<ArrowUpRight className="size-2.5" />
						</a>
					) : null}
				</div>
			</div>
		</div>
	);
}

const trainingStatusTone: Record<PersonLoraTrainingStatus | "ready", string> = {
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	generating: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	training: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	publishing: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

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

function getLoraStatusIcon(
	effectiveStatus: PersonLoraTrainingStatus | "ready" | undefined,
	isTraining: boolean
) {
	if (isTraining) {
		return <Loader2 className="size-3 animate-spin" />;
	}
	if (effectiveStatus === "ready") {
		return <CheckCircle2 className="size-3" />;
	}
	return null;
}

function getLoraProgressBarClass(
	effectiveStatus: PersonLoraTrainingStatus | "ready" | undefined
) {
	if (effectiveStatus === "failed") {
		return "bg-rose-500/80";
	}
	if (effectiveStatus === "ready") {
		return "bg-emerald-500/80";
	}
	return "bg-[linear-gradient(90deg,rgba(14,165,233,0.65),rgba(139,92,246,0.8),rgba(245,158,11,0.8))]";
}

function getLoraStageClassName(stage: { active: boolean; done: boolean }) {
	if (stage.done) {
		return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
	}
	if (stage.active) {
		return "border-violet-500/30 bg-violet-500/8 text-violet-700 dark:text-violet-300";
	}
	return "border-border/50 bg-background/40 text-muted-foreground";
}

function LoraTrainingStatusPanel({
	effectiveStatus,
	isTraining,
	phaseLabel,
	progressPct,
	referenceImageCount,
	referenceImageTarget,
	training,
}: {
	effectiveStatus: PersonLoraTrainingStatus | "ready";
	isTraining: boolean;
	phaseLabel: string;
	progressPct: number;
	referenceImageCount: number;
	referenceImageTarget: number;
	training: PersonLoraTrainingMeta | null;
}) {
	const stageItems = [
		{
			active: effectiveStatus === "queued",
			done: true,
			label: "Queued",
		},
		{
			active: effectiveStatus === "generating",
			done:
				effectiveStatus === "training" ||
				effectiveStatus === "publishing" ||
				effectiveStatus === "ready" ||
				effectiveStatus === "failed",
			label: "Dataset",
		},
		{
			active:
				effectiveStatus === "training" || effectiveStatus === "publishing",
			done: effectiveStatus === "ready" || effectiveStatus === "failed",
			label: "Training",
		},
		{
			active: effectiveStatus === "ready",
			done: effectiveStatus === "ready",
			label: "Ready",
		},
	];
	const elapsed = formatDurationMs(training?.trainingElapsedMs);
	const lastEventAt = training?.lastEventAt ?? training?.updatedAt ?? null;

	return (
		<div className="grid gap-3 rounded-xl border border-border/50 bg-muted/10 p-3 dark:bg-muted/5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
							trainingStatusTone[effectiveStatus] ??
								"bg-muted/10 text-muted-foreground"
						)}
					>
						{getLoraStatusIcon(effectiveStatus, isTraining)}
						{effectiveStatus}
					</span>
					{training?.triggerWord ? (
						<span className="text-muted-foreground text-xs">
							trigger: {training.triggerWord}
						</span>
					) : null}
				</div>
				<span className="font-medium text-xs">{progressPct}%</span>
			</div>

			<div className="grid gap-2">
				<div className="flex items-center justify-between gap-2 text-[11px]">
					<span className="text-muted-foreground">{phaseLabel}</span>
					{training?.provider ? (
						<span className="text-muted-foreground">{training.provider}</span>
					) : null}
				</div>
				<div className="h-2 overflow-hidden rounded-full bg-muted/30 dark:bg-muted/15">
					<div
						className={cn(
							"h-full rounded-full transition-[width] duration-500",
							getLoraProgressBarClass(effectiveStatus)
						)}
						style={{ width: `${progressPct}%` }}
					/>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{stageItems.map((stage) => (
					<div
						className={cn(
							"rounded-lg border px-2.5 py-2 text-[11px] transition-colors",
							getLoraStageClassName(stage)
						)}
						key={stage.label}
					>
						{stage.label}
					</div>
				))}
			</div>

			<div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
				{referenceImageCount > 0 ? (
					<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
						refs {referenceImageCount}/{referenceImageTarget}
					</span>
				) : null}
				{training?.trainingSteps ? (
					<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
						steps {training.trainingSteps}
					</span>
				) : null}
				{training?.providerStatus ? (
					<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
						provider {training.providerStatus}
					</span>
				) : null}
				{elapsed ? (
					<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
						elapsed {elapsed}
					</span>
				) : null}
				{lastEventAt ? (
					<span className="rounded-full bg-muted/15 px-2 py-0.5 dark:bg-muted/8">
						updated {formatRelativeTime(lastEventAt)}
					</span>
				) : null}
			</div>
		</div>
	);
}

function LoraTrainingActions({
	hasLora,
	isCancellingTraining,
	isTraining,
	onCancelTraining,
	onTrainLora,
}: {
	hasLora: boolean;
	isCancellingTraining: boolean;
	isTraining: boolean;
	onCancelTraining: () => void;
	onTrainLora: () => void;
}) {
	const actionLabel = hasLora ? "Retrain LoRA" : "Train LoRA";
	const pendingLabel = hasLora ? "Retraining..." : "Training...";

	return (
		<>
			<Button
				disabled={isTraining || isCancellingTraining}
				onClick={onTrainLora}
				size="sm"
				variant="outline"
			>
				{isTraining ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<Sparkles className="size-3.5" />
				)}
				{isTraining ? pendingLabel : actionLabel}
			</Button>
			{isTraining ? (
				<Button
					disabled={isCancellingTraining}
					onClick={onCancelTraining}
					size="sm"
					variant="destructive"
				>
					{isCancellingTraining ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<X className="size-3.5" />
					)}
					{isCancellingTraining ? "Cancelling..." : "Cancel pipeline"}
				</Button>
			) : null}
		</>
	);
}

function EnhanceWithGrokToggle({
	checked,
	disabled = false,
	disabledHint,
	id,
	onChange,
	tooltip,
}: {
	checked: boolean;
	disabled?: boolean;
	disabledHint?: string;
	id: string;
	onChange: (value: boolean) => void;
	tooltip: string;
}) {
	const isActive = checked && !disabled;
	const tooltipText = disabled && disabledHint ? disabledHint : tooltip;
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="block" />}>
				<label
					className={cn(
						"flex items-center gap-2 rounded-lg border bg-background/40 px-3 py-2 text-xs transition-colors",
						disabled
							? "cursor-not-allowed border-border/40 opacity-60"
							: "cursor-pointer",
						isActive
							? "border-violet-400/60 bg-violet-500/5"
							: "border-border/60",
						!(disabled || isActive) && "hover:border-border"
					)}
				>
					<input
						checked={isActive}
						className={cn(
							"size-3.5 accent-violet-500",
							disabled ? "cursor-not-allowed" : "cursor-pointer"
						)}
						disabled={disabled}
						id={id}
						onChange={(event) => onChange(event.target.checked)}
						type="checkbox"
					/>
					<span className="flex items-center gap-1 font-medium leading-none">
						<Sparkles className="size-3 text-violet-500" />
						Enhance with Grok
					</span>
				</label>
			</TooltipTrigger>
			<TooltipContent className="max-w-sm items-start text-left leading-relaxed">
				{tooltipText}
			</TooltipContent>
		</Tooltip>
	);
}

function LoraActions({
	isCancellingTraining,
	person,
	onCancelTraining,
	onTrainLora,
	onGenerateWithLora,
}: {
	isCancellingTraining: boolean;
	person: PersonRecord;
	onCancelTraining: () => void;
	onTrainLora: () => void;
	onGenerateWithLora: (
		prompt: string,
		options?: {
			enhance?: boolean;
			extraLoraUrl?: string;
			extraLoraWeight?: number;
		}
	) => void;
}) {
	const [loraPrompt, setLoraPrompt] = useState("");
	const [enhanceLoraPrompt, setEnhanceLoraPrompt] = useState(false);
	const [extraLoraId, setExtraLoraId] = useState("");
	const [extraLoraWeight, setExtraLoraWeight] = useState("");
	const [availableLoras, setAvailableLoras] = useState<LoraRegistryEntry[]>([]);
	useEffect(() => {
		let cancelled = false;
		fetchLoras("z-image").then((items) => {
			if (!cancelled) {
				setAvailableLoras(items);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);
	const training = readPersonLoraTrainingMeta(person);
	const hasLora = Boolean(person.loraUrl);
	const effectiveStatus = getPersonLoraTrainingDisplayStatus(training, hasLora);
	const progressPct = getPersonLoraTrainingProgressPct(training, hasLora);
	const phaseLabel = getPersonLoraTrainingPhaseLabel(training, hasLora);
	const referenceImageCount = getPersonLoraReferenceImageCount(training);
	const referenceImageTarget = getPersonLoraReferenceImageTarget(training);
	const isTraining = isActivePersonLoraTrainingStatus(effectiveStatus);
	const hasTrainingError = Boolean(training?.errorSummary);
	const showTrainingSection = !hasLora || isTraining || hasTrainingError;

	return (
		<div className="grid gap-3">
			{showTrainingSection ? (
				<>
					<SectionLabel>LoRA training</SectionLabel>

					{effectiveStatus ? (
						<LoraTrainingStatusPanel
							effectiveStatus={effectiveStatus}
							isTraining={isTraining}
							phaseLabel={phaseLabel}
							progressPct={progressPct}
							referenceImageCount={referenceImageCount}
							referenceImageTarget={referenceImageTarget}
							training={training}
						/>
					) : null}

					{training?.errorSummary ? (
						<p className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
							{training.errorSummary}
						</p>
					) : null}

					<LoraTrainingActions
						hasLora={hasLora}
						isCancellingTraining={isCancellingTraining}
						isTraining={isTraining}
						onCancelTraining={onCancelTraining}
						onTrainLora={onTrainLora}
					/>
				</>
			) : null}

			{hasLora ? (
				<div className="grid gap-2">
					<div className="flex items-center justify-between gap-2">
						<Label className="text-xs" htmlFor="loraPrompt">
							Generate with LoRA
						</Label>
						<EnhancePromptButton
							enhance={enhancePersonsPrompt}
							onEnhanced={(enhanced) => {
								setLoraPrompt(enhanced);
								toast.success("Prompt enhanced with Grok");
							}}
							onError={(message) => toast.error(message)}
							prompt={loraPrompt}
						/>
					</div>
					<textarea
						className={textareaClassName}
						id="loraPrompt"
						onChange={(e) => setLoraPrompt(e.target.value)}
						placeholder="portrait photo, studio lighting..."
						value={loraPrompt}
					/>
					<div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
						<div className="grid gap-1.5">
							<Label className="text-xs" htmlFor="extraLoraId">
								Extra LoRA
							</Label>
							<select
								className={selectClassName}
								id="extraLoraId"
								onChange={(event) => {
									const nextId = event.target.value;
									setExtraLoraId(nextId);
									const entry = availableLoras.find(
										(item) => item.id === nextId
									);
									if (entry) {
										setExtraLoraWeight(String(entry.defaultWeight));
									}
								}}
								value={extraLoraId}
							>
								<option value="">None</option>
								{availableLoras.map((entry) => (
									<option key={entry.id} value={entry.id}>
										{entry.name}
									</option>
								))}
							</select>
							<p className="text-[11px] text-muted-foreground/70">
								Managed in{" "}
								<a
									className="underline"
									href={adminLorasHref}
									rel="noreferrer noopener"
									target="_blank"
								>
									admin · LoRAs
								</a>
								.
							</p>
						</div>
						{extraLoraId ? (
							<div className="grid gap-1.5">
								<Label className="text-xs" htmlFor="extraLoraWeight">
									Extra LoRA weight
								</Label>
								<Input
									id="extraLoraWeight"
									onChange={(event) => setExtraLoraWeight(event.target.value)}
									placeholder="0.05"
									value={extraLoraWeight}
								/>
							</div>
						) : null}
					</div>
					<EnhanceWithGrokToggle
						checked={enhanceLoraPrompt}
						id={`enhanceLoraPrompt-${person.id}`}
						onChange={setEnhanceLoraPrompt}
						tooltip="Grok перепишет ваш промт, добавив детали для более качественной генерации"
					/>
					<Button
						disabled={!loraPrompt.trim()}
						onClick={() => {
							const selectedEntry = availableLoras.find(
								(item) => item.id === extraLoraId
							);
							const parsedExtraLoraWeight = Number.parseFloat(extraLoraWeight);
							const resolvedExtraLoraUrl = selectedEntry?.s3Url;
							const fallbackWeight = selectedEntry?.defaultWeight ?? 0.05;
							onGenerateWithLora(loraPrompt.trim(), {
								enhance: enhanceLoraPrompt,
								extraLoraUrl: resolvedExtraLoraUrl,
								extraLoraWeight: Number.isFinite(parsedExtraLoraWeight)
									? parsedExtraLoraWeight
									: fallbackWeight,
							});
							setLoraPrompt("");
							setEnhanceLoraPrompt(false);
						}}
						size="sm"
					>
						<Sparkles className="size-3.5" />
						Generate with LoRA
					</Button>
					{isTraining || hasTrainingError ? null : (
						<button
							className="justify-self-start text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
							onClick={onTrainLora}
							type="button"
						>
							Retrain LoRA
						</button>
					)}
				</div>
			) : null}
		</div>
	);
}

interface DatasetImageItem {
	generationId: string | null;
	url: string;
}

function DatasetGallery({
	isGenerating,
	items,
	onDelete,
	onImageClick,
	pendingDeleteId,
}: {
	isGenerating: boolean;
	items: DatasetImageItem[];
	onDelete: (generationId: string) => void;
	onImageClick: (index: number) => void;
	pendingDeleteId: string | null;
}) {
	if (items.length === 0 && !isGenerating) {
		return (
			<EmptyState
				hint="Dataset photos will appear here after LoRA training starts."
				message="No dataset photos yet."
			/>
		);
	}
	return (
		<div className="grid gap-3">
			{isGenerating ? (
				<div className="flex items-center gap-2 text-muted-foreground text-xs">
					<Loader2 className="size-3.5 animate-spin" />
					<span>
						Generating dataset… {items.length} /{" "}
						{DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT}
					</span>
				</div>
			) : null}
			{items.length > 0 ? (
				<div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
					{items.map((item, i) => (
						<div className="group relative" key={item.url}>
							<button
								aria-label={`View reference ${i + 1}`}
								className="relative aspect-[3/4] w-full overflow-hidden rounded-lg transition hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => onImageClick(i)}
								type="button"
							>
								<Image
									alt={`Reference ${i + 1}`}
									className="object-cover"
									fill
									sizes="(max-width: 768px) 33vw, 160px"
									src={item.url}
								/>
							</button>
							{item.generationId ? (
								<button
									aria-label={`Delete reference ${i + 1}`}
									className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm ring-1 ring-border/50 transition hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:hover:text-rose-400"
									disabled={pendingDeleteId === item.generationId}
									onClick={() => {
										if (item.generationId) {
											onDelete(item.generationId);
										}
									}}
									type="button"
								>
									{pendingDeleteId === item.generationId ? (
										<Loader2 className="size-3.5 animate-spin" />
									) : (
										<Trash2 className="size-3.5" />
									)}
								</button>
							) : null}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

type DetailTab = "generations" | "dataset";

function parseTimestamp(value: string) {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareGenerationNewestFirst(
	a: PersonGenerationRecord,
	b: PersonGenerationRecord
) {
	const createdDiff = parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt);
	if (createdDiff !== 0) {
		return createdDiff;
	}

	return b.id.localeCompare(a.id);
}

function PersonDetailView({
	cancellingGenerationId,
	isCancellingTraining,
	deletingGenerationId,
	person,
	studioUrl,
	onCancelGeneration,
	onCancelTraining,
	onDeleteGeneration,
	onTrainLora,
	onGenerateWithLora,
}: {
	cancellingGenerationId: string | null;
	isCancellingTraining: boolean;
	deletingGenerationId: string | null;
	person: PersonRecord;
	studioUrl: string;
	onCancelGeneration: (generationId: string) => void;
	onCancelTraining: () => void;
	onDeleteGeneration: (generationId: string) => void;
	onTrainLora: () => void;
	onGenerateWithLora: (
		prompt: string,
		options?: {
			enhance?: boolean;
			extraLoraUrl?: string;
			extraLoraWeight?: number;
		}
	) => void;
}) {
	const [activeTab, setActiveTab] = useState<DetailTab>("generations");
	const [lightbox, setLightbox] = useState<LightboxState | null>(null);
	const trainingMeta = readPersonLoraTrainingMeta(person);
	const isGeneratingDataset = trainingMeta?.status === "generating";
	const generations = person.generations
		.filter((g) => g.metadata.isDatasetPhoto !== true)
		.sort(compareGenerationNewestFirst);
	const datasetPhotos = person.generations.filter(
		(g) => g.metadata.isDatasetPhoto === true
	);
	const datasetPhotoItems = datasetPhotos.map((g) => ({
		generationId: g.id,
		url: g.sourceUrl,
	}));
	const datasetItems: DatasetImageItem[] =
		trainingMeta?.referenceImageUrls &&
		trainingMeta.referenceImageUrls.length > 0
			? trainingMeta.referenceImageUrls.map((url) => ({
					generationId:
						datasetPhotos.find((generation) => generation.sourceUrl === url)
							?.id ?? null,
					url,
				}))
			: datasetPhotoItems;
	const datasetUrls = datasetItems.map((item) => item.url);

	const imageGenerations = generations.filter(
		(g) => g.mediaType === "image" && g.status === "ready"
	);
	const generationImageUrls = imageGenerations.map(
		(g) => g.previewUrl ?? g.sourceUrl
	);

	function openGenerationLightbox(generationId: string) {
		const idx = imageGenerations.findIndex((g) => g.id === generationId);
		if (idx >= 0) {
			setLightbox({ images: generationImageUrls, index: idx });
		}
	}

	function openDatasetLightbox(index: number) {
		setLightbox({ images: datasetUrls, index });
	}

	function openReferenceLightbox() {
		setLightbox({ images: [person.referencePhotoUrl], index: 0 });
	}

	const assets = (
		[
			{ href: person.datasetUrl, icon: FolderArchive, label: "Dataset" },
			{ href: person.loraUrl, icon: Sparkles, label: "LoRA" },
			{ href: person.photoUrl, icon: ImageIcon, label: "Photo" },
			{ href: person.videoUrl, icon: Clapperboard, label: "Video" },
			{ href: person.voiceWavUrl, icon: AudioWaveform, label: "Voice" },
		] as const
	).filter((a): a is typeof a & { href: string } => typeof a.href === "string");

	return (
		<div className="grid h-full min-h-0 gap-6 overflow-y-auto pr-1">
			{lightbox ? (
				<Lightbox
					images={lightbox.images}
					index={lightbox.index}
					onClose={() => setLightbox(null)}
					onNavigate={(i) =>
						setLightbox((prev) => (prev ? { ...prev, index: i } : null))
					}
				/>
			) : null}

			{/* Hero + Assets */}
			<div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
				<div className="relative w-full max-w-[260px] sm:max-w-none">
					<Link
						aria-label="Back to cast"
						className="absolute top-2 left-2 z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-background/80 text-foreground/70 shadow-sm ring-1 ring-border/40 backdrop-blur transition hover:bg-background hover:text-foreground"
						href={CAST_HREF}
					>
						<ArrowLeft className="size-3.5" />
					</Link>
					<button
						aria-label={`View ${person.name} reference photo`}
						className="group relative block aspect-[3/4] w-full overflow-hidden rounded-2xl shadow-black/5 shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-black/20"
						onClick={openReferenceLightbox}
						type="button"
					>
						<Image
							alt={person.name}
							className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
							fill
							priority
							sizes="(max-width: 640px) 260px, (max-width: 1280px) 220px, 260px"
							src={person.referencePhotoUrl}
						/>
						<div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
					</button>
				</div>

				<div className="grid min-w-0 content-start gap-4">
					{person.description ? (
						<p className="line-clamp-3 text-muted-foreground text-sm leading-relaxed">
							{person.description}
						</p>
					) : null}

					{assets.length > 0 ? (
						<div className="flex flex-wrap gap-1.5">
							{assets.map((asset) => (
								<a
									className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/80 px-3 py-1.5 text-xs transition hover:border-border hover:bg-muted/30"
									href={asset.href}
									key={asset.label}
									rel="noreferrer noopener"
									target="_blank"
								>
									<asset.icon
										className="size-3 text-muted-foreground/60"
										strokeWidth={1.5}
									/>
									{asset.label}
									<ArrowUpRight className="size-3 text-muted-foreground/40" />
								</a>
							))}
						</div>
					) : null}

					<LoraActions
						isCancellingTraining={isCancellingTraining}
						onCancelTraining={onCancelTraining}
						onGenerateWithLora={onGenerateWithLora}
						onTrainLora={onTrainLora}
						person={person}
					/>
				</div>
			</div>

			{/* Tabs */}
			<div className="grid min-w-0 gap-4">
				<div className="flex gap-6 border-border/40 border-b">
					<button
						className={cn(
							"-mb-px border-b-2 pb-2.5 font-medium text-sm transition",
							activeTab === "generations"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
						)}
						onClick={() => setActiveTab("generations")}
						type="button"
					>
						Generations
						{generations.length > 0 ? (
							<span className="ml-1.5 rounded-full bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-muted/20">
								{generations.length}
							</span>
						) : null}
					</button>
					<button
						className={cn(
							"-mb-px border-b-2 pb-2.5 font-medium text-sm transition",
							activeTab === "dataset"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
						)}
						onClick={() => setActiveTab("dataset")}
						type="button"
					>
						Dataset
						{datasetUrls.length > 0 ? (
							<span className="ml-1.5 rounded-full bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-muted/20">
								{datasetUrls.length}
							</span>
						) : null}
					</button>
				</div>

				{activeTab === "generations" && generations.length > 0 ? (
					<div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
						{generations.map((generation) => (
							<GenerationCard
								generation={generation}
								isCancelling={cancellingGenerationId === generation.id}
								isDeleting={deletingGenerationId === generation.id}
								key={generation.id}
								onCancel={() => onCancelGeneration(generation.id)}
								onDelete={() => onDeleteGeneration(generation.id)}
								onImageClick={
									generation.mediaType === "image" &&
									generation.status === "ready"
										? () => openGenerationLightbox(generation.id)
										: undefined
								}
								studioUrl={studioUrl}
							/>
						))}
					</div>
				) : null}

				{activeTab === "generations" && generations.length === 0 ? (
					<EmptyState
						hint="Run a scenario in Studio to generate media for this person."
						message="No generations yet."
					/>
				) : null}

				{activeTab === "dataset" ? (
					<DatasetGallery
						isGenerating={isGeneratingDataset}
						items={datasetItems}
						onDelete={onDeleteGeneration}
						onImageClick={openDatasetLightbox}
						pendingDeleteId={deletingGenerationId}
					/>
				) : null}
			</div>
		</div>
	);
}

function canSubmitForm(form: CreatePersonInput) {
	const hasName = Boolean(form.name.trim());
	const hasRef = Boolean(form.referencePhotoUrl?.trim());
	const hasDesc = Boolean(form.description?.trim());
	return hasName && (hasRef || hasDesc);
}

function willRunPipeline(form: CreatePersonInput) {
	return !form.loraUrl?.trim();
}

function shouldPickReferenceVariant(form: CreatePersonInput) {
	const hasRef = Boolean(form.referencePhotoUrl?.trim());
	const hasDesc = Boolean(form.description?.trim());
	const hasLora = Boolean(form.loraUrl?.trim());
	return !hasRef && hasDesc && !hasLora;
}

function getCreatePersonSubmitLabel(formState: CreatePersonInput) {
	return shouldPickReferenceVariant(formState)
		? "Generate references"
		: "Create";
}

export const PERSON_REFERENCE_DRAFT_STORAGE_KEY = "persons-web:reference-draft";

export interface PersonReferenceDraft {
	enhanced: boolean;
	executionIds: string[];
	form: CreatePersonInput;
	prompt: string;
	prompts: string[];
}

const REFERENCES_HREF = "/new/references" as Route<"/new/references">;

async function createReferenceVariantDraft(
	formState: CreatePersonInput,
	options: { enhance: boolean }
): Promise<PersonReferenceDraft> {
	const prompt = formState.description?.trim() ?? "";
	const batch = await requestAvatarPreviews({
		prompt,
		count: 4,
		enhance: options.enhance,
	});
	return {
		enhanced: batch.enhanced,
		executionIds: batch.executions.map((execution) => execution.id),
		form: formState,
		prompt,
		prompts: batch.prompts,
	};
}

function persistReferenceVariantDraft(draft: PersonReferenceDraft) {
	if (typeof window !== "undefined") {
		window.sessionStorage.setItem(
			PERSON_REFERENCE_DRAFT_STORAGE_KEY,
			JSON.stringify(draft)
		);
	}
}

function CreatePersonHint({ formState }: { formState: CreatePersonInput }) {
	if (shouldPickReferenceVariant(formState)) {
		return (
			<p className="text-center text-[11px] text-muted-foreground/60">
				We&apos;ll generate a few reference variants for you to pick from
			</p>
		);
	}

	if (willRunPipeline(formState)) {
		return (
			<p className="text-center text-[11px] text-muted-foreground/60">
				LoRA pipeline will run automatically
			</p>
		);
	}

	return null;
}

function CreatePersonForm({
	enhance,
	formState,
	isCreating,
	onEnhanceChange,
	onFieldChange,
	onSubmit,
}: {
	enhance: boolean;
	formState: CreatePersonInput;
	isCreating: boolean;
	onEnhanceChange: (value: boolean) => void;
	onFieldChange: <Key extends keyof CreatePersonInput>(
		key: Key,
		value: CreatePersonInput[Key]
	) => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
	const [showMore, setShowMore] = useState(false);
	const hasReferencePhoto = Boolean(formState.referencePhotoUrl?.trim());
	const enhanceDisabled = hasReferencePhoto;
	const isEnhanceActive = enhance && !enhanceDisabled;

	return (
		<WorkspacePane className="min-h-0">
			<div className="grid h-full min-h-0 gap-0">
				<div className="px-4 py-3">
					<SectionLabel>New person</SectionLabel>
				</div>
				<div className="min-h-0 overflow-y-auto px-4 pb-4">
					<form className="grid gap-3" onSubmit={onSubmit}>
						<div className="grid gap-1.5">
							<Label className="text-xs" htmlFor="name">
								Name
							</Label>
							<Input
								id="name"
								onChange={(event) => onFieldChange("name", event.target.value)}
								placeholder="Mila North"
								value={formState.name}
							/>
						</div>
						<div className="grid gap-1.5">
							<div className="flex items-center justify-between gap-2">
								<Label className="text-xs" htmlFor="description">
									Description
								</Label>
								<EnhancePromptButton
									enhance={enhancePersonsPrompt}
									onEnhanced={(enhanced) => {
										onFieldChange("description", enhanced);
										toast.success("Description enhanced with Grok");
									}}
									onError={(message) => toast.error(message)}
									prompt={formState.description ?? ""}
								/>
							</div>
							<textarea
								className={textareaClassName}
								id="description"
								onChange={(event) =>
									onFieldChange("description", event.target.value)
								}
								placeholder="Young woman, sharp jawline, dark wavy hair…"
								value={formState.description ?? ""}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label className="text-xs" htmlFor="referencePhotoUrl">
								Reference photo URL
							</Label>
							<Input
								id="referencePhotoUrl"
								onChange={(event) =>
									onFieldChange("referencePhotoUrl", event.target.value)
								}
								placeholder="https://..."
								value={formState.referencePhotoUrl ?? ""}
							/>
						</div>

						<button
							className="flex items-center gap-1.5 text-muted-foreground text-xs transition hover:text-foreground"
							onClick={() => setShowMore((v) => !v)}
							type="button"
						>
							<ChevronDown
								className={cn(
									"size-3.5 transition-transform",
									showMore && "rotate-180"
								)}
							/>
							More options
						</button>

						{showMore ? (
							<div className="fade-in slide-in-from-top-1 grid animate-in gap-3">
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="datasetUrl">
										Dataset
									</Label>
									<Input
										id="datasetUrl"
										onChange={(event) =>
											onFieldChange("datasetUrl", event.target.value)
										}
										placeholder="zip url"
										value={formState.datasetUrl ?? ""}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="loraUrl">
										LoRA
									</Label>
									<Input
										id="loraUrl"
										onChange={(event) =>
											onFieldChange("loraUrl", event.target.value)
										}
										placeholder="safetensors url"
										value={formState.loraUrl ?? ""}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="videoUrl">
										Video
									</Label>
									<Input
										id="videoUrl"
										onChange={(event) =>
											onFieldChange("videoUrl", event.target.value)
										}
										placeholder="mp4 url"
										value={formState.videoUrl ?? ""}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="voiceWavUrl">
										Voice WAV
									</Label>
									<Input
										id="voiceWavUrl"
										onChange={(event) =>
											onFieldChange("voiceWavUrl", event.target.value)
										}
										placeholder="wav url"
										value={formState.voiceWavUrl ?? ""}
									/>
								</div>
							</div>
						) : null}

						<EnhanceWithGrokToggle
							checked={isEnhanceActive}
							disabled={enhanceDisabled}
							disabledHint="Недоступно при загруженном референсном фото"
							id="enhancePrompt"
							onChange={onEnhanceChange}
							tooltip="Обогатим промт и сгенерируем 4 разные референсные девушки"
						/>

						<Button
							disabled={isCreating || !canSubmitForm(formState)}
							size="sm"
							type="submit"
						>
							{isCreating ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Upload className="size-3.5" />
							)}
							{getCreatePersonSubmitLabel(formState)}
						</Button>
						<CreatePersonHint formState={formState} />
					</form>
				</div>
			</div>
		</WorkspacePane>
	);
}

function ManagePersonForm({
	formState,
	isDeleting,
	isUpdating,
	onDelete,
	onFieldChange,
	onSubmit,
	person,
}: {
	formState: PersonManagementFormState;
	isDeleting: boolean;
	isUpdating: boolean;
	onDelete: () => void;
	onFieldChange: <Key extends keyof PersonManagementFormState>(
		key: Key,
		value: PersonManagementFormState[Key]
	) => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	person: PersonRecord;
}) {
	const [showAssets, setShowAssets] = useState(false);
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const isDeleteDisabled = isDeleting || isUpdating;
	const canSave =
		Boolean(formState.name.trim()) &&
		Boolean(formState.referencePhotoUrl.trim());

	return (
		<WorkspacePane className="min-h-0">
			<div className="grid h-full min-h-0 gap-0">
				<div className="px-4 py-3">
					<SectionLabel>Manage person</SectionLabel>
				</div>
				<div className="min-h-0 overflow-y-auto px-4 pb-4">
					<form className="grid gap-3" onSubmit={onSubmit}>
						<div className="grid gap-1.5">
							<Label className="text-xs" htmlFor="editName">
								Name
							</Label>
							<Input
								id="editName"
								onChange={(event) => onFieldChange("name", event.target.value)}
								value={formState.name}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label className="text-xs" htmlFor="editSlug">
								Slug
							</Label>
							<Input
								id="editSlug"
								onChange={(event) => onFieldChange("slug", event.target.value)}
								value={formState.slug}
							/>
						</div>
						<div className="grid gap-1.5">
							<div className="flex items-center justify-between gap-2">
								<Label className="text-xs" htmlFor="editDescription">
									Description
								</Label>
								<EnhancePromptButton
									enhance={enhancePersonsPrompt}
									onEnhanced={(enhanced) => {
										onFieldChange("description", enhanced);
										toast.success("Description enhanced with Grok");
									}}
									onError={(message) => toast.error(message)}
									prompt={formState.description}
								/>
							</div>
							<textarea
								className={textareaClassName}
								id="editDescription"
								onChange={(event) =>
									onFieldChange("description", event.target.value)
								}
								value={formState.description}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label className="text-xs" htmlFor="editReferencePhotoUrl">
								Reference photo URL
							</Label>
							<Input
								id="editReferencePhotoUrl"
								onChange={(event) =>
									onFieldChange("referencePhotoUrl", event.target.value)
								}
								value={formState.referencePhotoUrl}
							/>
						</div>

						<button
							className="flex items-center gap-1.5 text-muted-foreground text-xs transition hover:text-foreground"
							onClick={() => setShowAssets((value) => !value)}
							type="button"
						>
							<ChevronDown
								className={cn(
									"size-3.5 transition-transform",
									showAssets && "rotate-180"
								)}
							/>
							Asset URLs
						</button>

						{showAssets ? (
							<div className="fade-in slide-in-from-top-1 grid animate-in gap-3">
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="editDatasetUrl">
										Dataset
									</Label>
									<Input
										id="editDatasetUrl"
										onChange={(event) =>
											onFieldChange("datasetUrl", event.target.value)
										}
										placeholder="zip url"
										value={formState.datasetUrl}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="editLoraUrl">
										LoRA
									</Label>
									<Input
										id="editLoraUrl"
										onChange={(event) =>
											onFieldChange("loraUrl", event.target.value)
										}
										placeholder="safetensors url"
										value={formState.loraUrl}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="editPhotoUrl">
										Photo
									</Label>
									<Input
										id="editPhotoUrl"
										onChange={(event) =>
											onFieldChange("photoUrl", event.target.value)
										}
										placeholder="image url"
										value={formState.photoUrl}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="editVideoUrl">
										Video
									</Label>
									<Input
										id="editVideoUrl"
										onChange={(event) =>
											onFieldChange("videoUrl", event.target.value)
										}
										placeholder="mp4 url"
										value={formState.videoUrl}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs" htmlFor="editVoiceWavUrl">
										Voice WAV
									</Label>
									<Input
										id="editVoiceWavUrl"
										onChange={(event) =>
											onFieldChange("voiceWavUrl", event.target.value)
										}
										placeholder="wav url"
										value={formState.voiceWavUrl}
									/>
								</div>
							</div>
						) : null}

						<Button disabled={isUpdating || !canSave} size="sm" type="submit">
							{isUpdating ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Save className="size-3.5" />
							)}
							Save changes
						</Button>
					</form>

					<div className="mt-4 border-border/50 border-t pt-4">
						{isConfirmingDelete ? (
							<div className="grid gap-2">
								<p className="text-muted-foreground text-xs">
									Delete {person.name} and all related generations?
								</p>
								<div className="grid grid-cols-2 gap-2">
									<Button
										disabled={isDeleteDisabled}
										onClick={() => setIsConfirmingDelete(false)}
										size="sm"
										type="button"
										variant="outline"
									>
										Keep
									</Button>
									<Button
										disabled={isDeleteDisabled}
										onClick={onDelete}
										size="sm"
										type="button"
										variant="destructive"
									>
										{isDeleting ? (
											<Loader2 className="size-3.5 animate-spin" />
										) : (
											<Trash2 className="size-3.5" />
										)}
										Delete
									</Button>
								</div>
							</div>
						) : (
							<Button
								disabled={isDeleteDisabled}
								onClick={() => setIsConfirmingDelete(true)}
								size="sm"
								type="button"
								variant="destructive"
							>
								<Trash2 className="size-3.5" />
								Delete person
							</Button>
						)}
					</div>
				</div>
			</div>
		</WorkspacePane>
	);
}

export default function PersonsWorkspace({
	initialSnapshot,
	personSlug,
}: {
	initialSnapshot: { persons: PersonRecord[]; warnings: string[] };
	personSlug?: string;
}) {
	const [persons, setPersons] = useState(initialSnapshot.persons);
	const [formState, setFormState] = useState<CreatePersonInput>(
		createEmptyFormState()
	);
	const [enhanceWithGrok, setEnhanceWithGrok] = useState(false);
	const [managementFormState, setManagementFormState] =
		useState<PersonManagementFormState | null>(null);
	const [cancellingGenerationId, setCancellingGenerationId] = useState<
		string | null
	>(null);
	const [deletingGenerationId, setDeletingGenerationId] = useState<
		string | null
	>(null);
	const [isCancellingTraining, setIsCancellingTraining] = useState(false);
	const [isDeletingPerson, setIsDeletingPerson] = useState(false);
	const [isCreating, startCreateTransition] = useTransition();
	const [isUpdatingPerson, startUpdateTransition] = useTransition();
	const router = useRouter();

	const selectedPerson = personSlug
		? (persons.find((person) => person.slug === personSlug) ?? null)
		: null;

	useEffect(() => {
		setManagementFormState((current) => {
			if (!selectedPerson) {
				return null;
			}
			if (current?.personId === selectedPerson.id) {
				return current;
			}
			return createManagementFormState(selectedPerson);
		});
	}, [selectedPerson]);

	const needsPolling =
		persons.some((person) =>
			person.generations.some((generation) => generation.status === "queued")
		) ||
		persons.some((person) => {
			const training = readPersonLoraTrainingMeta(person);
			return isActivePersonLoraTrainingStatus(training?.status);
		});

	useEffect(() => {
		if (!needsPolling) {
			return;
		}

		const timer = window.setInterval(async () => {
			try {
				const snapshot = await getPersonsDashboard();
				setPersons(snapshot.persons);
			} catch {
				// Keep UI stable until the next successful refresh.
			}
		}, 5000);

		return () => window.clearInterval(timer);
	}, [needsPolling]);

	const totalGenerations = persons.reduce(
		(total, person) => total + person.generations.length,
		0
	);
	const activeTrainingCount = persons.filter((person) => {
		const training = readPersonLoraTrainingMeta(person);
		return isActivePersonLoraTrainingStatus(training?.status);
	}).length;
	const adminUrl = env.NEXT_PUBLIC_ADMIN_URL ?? DEFAULT_ADMIN_URL;
	const studioUrl = env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3002";

	function updateFormField<Key extends keyof CreatePersonInput>(
		key: Key,
		value: CreatePersonInput[Key]
	) {
		setFormState((current) => ({
			...current,
			[key]: value,
		}));
	}

	function updateManagementFormField<
		Key extends keyof PersonManagementFormState,
	>(key: Key, value: PersonManagementFormState[Key]) {
		setManagementFormState((current) =>
			current
				? {
						...current,
						[key]: value,
					}
				: current
		);
	}

	async function startReferenceVariantFlow(form: CreatePersonInput) {
		const draft = await createReferenceVariantDraft(form, {
			enhance: enhanceWithGrok,
		});
		persistReferenceVariantDraft(draft);
		setFormState(createEmptyFormState());
		setEnhanceWithGrok(false);
		router.push(REFERENCES_HREF);
	}

	async function createPersonAndMaybeTrain(form: CreatePersonInput) {
		const nextPerson = await createPerson(form);
		setPersons((current) => [nextPerson, ...current]);
		router.push(getPersonHrefBySlug(nextPerson.slug));
		setFormState(createEmptyFormState());
		toast.success("Person created");

		if (!willRunPipeline(form)) {
			return;
		}

		try {
			const updated = await trainPersonLora(nextPerson.id);
			setPersons((current) =>
				current.map((p) => (p.id === updated.id ? updated : p))
			);
			toast.success("LoRA pipeline started");
		} catch {
			toast.info(
				"Person created. Start the pipeline manually from the detail view."
			);
		}
	}

	function handleCreatePerson(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		startCreateTransition(async () => {
			try {
				if (shouldPickReferenceVariant(formState)) {
					await startReferenceVariantFlow(formState);
					return;
				}

				await createPersonAndMaybeTrain(formState);
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Unable to create person"
				);
			}
		});
	}

	function handleUpdatePerson(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!(selectedPerson && managementFormState)) {
			return;
		}

		startUpdateTransition(async () => {
			try {
				const updated = await updatePerson(
					selectedPerson.id,
					createUpdatePersonPayload(managementFormState)
				);
				setPersons((current) =>
					current.map((person) => (person.id === updated.id ? updated : person))
				);
				setManagementFormState(createManagementFormState(updated));
				if (updated.slug !== selectedPerson.slug) {
					router.replace(getPersonHrefBySlug(updated.slug));
				}
				toast.success("Person updated");
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Unable to update person"
				);
			}
		});
	}

	async function handleDeletePerson() {
		if (!(selectedPerson && !isDeletingPerson)) {
			return;
		}

		setIsDeletingPerson(true);
		try {
			await deletePerson(selectedPerson.id);
			setPersons((current) =>
				current.filter((person) => person.id !== selectedPerson.id)
			);
			router.push(CAST_HREF);
			toast.success("Person deleted");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to delete person"
			);
		} finally {
			setIsDeletingPerson(false);
		}
	}

	async function handleTrainLora() {
		if (!selectedPerson) {
			return;
		}
		try {
			const updated = await trainPersonLora(selectedPerson.id);
			setPersons((current) =>
				current.map((p) => (p.id === updated.id ? updated : p))
			);
			toast.success("LoRA training started");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to start training"
			);
		}
	}

	async function handleGenerateWithLora(
		prompt: string,
		options?: {
			enhance?: boolean;
			extraLoraUrl?: string;
			extraLoraWeight?: number;
		}
	) {
		if (!selectedPerson) {
			return;
		}
		const optimistic = createOptimisticLoraGeneration(
			selectedPerson.id,
			prompt
		);
		setPersons((current) =>
			current.map((p) =>
				p.id === selectedPerson.id
					? { ...p, generations: [optimistic, ...p.generations] }
					: p
			)
		);
		try {
			const updated = await generateWithLora(
				selectedPerson.id,
				prompt,
				options
			);
			setPersons((current) =>
				current.map((p) => (p.id === updated.id ? updated : p))
			);
			toast.success("Generation with LoRA started");
		} catch (error) {
			setPersons((current) =>
				current.map((p) =>
					p.id === selectedPerson.id
						? {
								...p,
								generations: p.generations.filter(
									(g) => g.id !== optimistic.id
								),
							}
						: p
				)
			);
			toast.error(
				error instanceof Error ? error.message : "Failed to start generation"
			);
		}
	}

	async function handleCancelGeneration(generationId: string) {
		if (!(selectedPerson && !cancellingGenerationId)) {
			return;
		}

		setCancellingGenerationId(generationId);
		try {
			const updated = await cancelGeneration(selectedPerson.id, generationId);
			setPersons((current) =>
				current.map((person) => (person.id === updated.id ? updated : person))
			);
			toast.success("Generation cancelled");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to cancel generation"
			);
		} finally {
			setCancellingGenerationId(null);
		}
	}

	async function handleCancelLoraTraining() {
		if (!(selectedPerson && !isCancellingTraining)) {
			return;
		}

		setIsCancellingTraining(true);
		try {
			const updated = await cancelPersonLoraTraining(selectedPerson.id);
			setPersons((current) =>
				current.map((person) => (person.id === updated.id ? updated : person))
			);
			toast.success("LoRA pipeline cancelled");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to cancel pipeline"
			);
		} finally {
			setIsCancellingTraining(false);
		}
	}

	async function handleDeleteGeneration(generationId: string) {
		if (!(selectedPerson && !deletingGenerationId)) {
			return;
		}

		setDeletingGenerationId(generationId);
		try {
			const updated = await deleteGeneration(selectedPerson.id, generationId);
			setPersons((current) =>
				current.map((p) => (p.id === updated.id ? updated : p))
			);
			toast.success("Generation deleted");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete generation"
			);
		} finally {
			setDeletingGenerationId(null);
		}
	}

	function getPersonHref(slug: string) {
		return getPersonHrefBySlug(slug);
	}

	return (
		<WorkspaceShell
			inspector={
				selectedPerson && managementFormState ? (
					<ManagePersonForm
						formState={managementFormState}
						isDeleting={isDeletingPerson}
						isUpdating={isUpdatingPerson}
						key={selectedPerson.id}
						onDelete={handleDeletePerson}
						onFieldChange={updateManagementFormField}
						onSubmit={handleUpdatePerson}
						person={selectedPerson}
					/>
				) : (
					<CreatePersonForm
						enhance={enhanceWithGrok}
						formState={formState}
						isCreating={isCreating}
						onEnhanceChange={setEnhanceWithGrok}
						onFieldChange={updateFormField}
						onSubmit={handleCreatePerson}
					/>
				)
			}
			navigation={createWorkspaceNavigation("persons", {
				admin: adminUrl,
				persons: "/",
				studio: studioUrl,
			})}
			status={
				<>
					<WorkspaceStatus tone="neutral">
						{persons.length} persons
					</WorkspaceStatus>
					<WorkspaceStatus tone="info">
						{totalGenerations} generations
					</WorkspaceStatus>
					{activeTrainingCount > 0 ? (
						<WorkspaceStatus tone="warning">
							{activeTrainingCount} training
						</WorkspaceStatus>
					) : null}
				</>
			}
			subtitle={
				selectedPerson
					? `${selectedPerson.generations.length} generations`
					: "Reusable cast workspace"
			}
			title={selectedPerson?.name ?? "Cast"}
			workspaceLabel="Persons"
		>
			{selectedPerson ? (
				<PersonDetailView
					cancellingGenerationId={cancellingGenerationId}
					deletingGenerationId={deletingGenerationId}
					isCancellingTraining={isCancellingTraining}
					onCancelGeneration={handleCancelGeneration}
					onCancelTraining={handleCancelLoraTraining}
					onDeleteGeneration={handleDeleteGeneration}
					onGenerateWithLora={handleGenerateWithLora}
					onTrainLora={handleTrainLora}
					person={selectedPerson}
					studioUrl={studioUrl}
				/>
			) : (
				<CastGrid getHref={getPersonHref} persons={persons} />
			)}
		</WorkspaceShell>
	);
}
