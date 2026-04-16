"use client";

import { env } from "@generator/env/web";
import { Button } from "@generator/ui/components/button";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import WorkspaceShell, {
	WorkspacePane,
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { cn } from "@generator/ui/lib/utils";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import {
	ArrowLeft,
	ArrowUpRight,
	AudioLines,
	AudioWaveform,
	type Box,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clapperboard,
	CloudOff,
	FolderArchive,
	ImageIcon,
	Loader2,
	Sparkles,
	Upload,
	UsersRound,
	X,
} from "lucide-react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
	type CreatePersonInput,
	createPerson,
	generateWithLora,
	getPersonsDashboard,
	type PersonGenerationRecord,
	type PersonRecord,
	trainPersonLora,
} from "@/lib/persons-api";

const textareaClassName =
	"flex min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

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

function buildPersonsHref(
	pathname: string,
	currentSearch: string,
	personSlug: string | null
) {
	const url = new URLSearchParams(currentSearch);
	if (personSlug) {
		url.set("person", personSlug);
	} else {
		url.delete("person");
	}
	const nextSearch = url.toString();
	return (nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route;
}

function createEmptyFormState(): CreatePersonInput {
	return {
		name: "",
		description: "",
	};
}

function PersonAsset({
	href,
	icon: Icon,
	label,
	value,
}: {
	href: string | null;
	icon: typeof Box;
	label: string;
	value: string;
}) {
	return (
		<div className="flex items-center gap-3 rounded-lg bg-muted/10 px-3 py-2.5 dark:bg-muted/5">
			<Icon
				className="size-4 shrink-0 text-muted-foreground/60"
				strokeWidth={1.5}
			/>
			<div className="min-w-0 flex-1">
				<p className="text-muted-foreground text-xs">{label}</p>
			</div>
			{href ? (
				<a
					className="inline-flex items-center gap-1 text-xs hover:underline"
					href={href}
					rel="noreferrer noopener"
					target="_blank"
				>
					{value}
					<ArrowUpRight className="size-3" />
				</a>
			) : (
				<span className="text-muted-foreground/40 text-xs">—</span>
			)}
		</div>
	);
}

function GenerationPreview({
	generation,
	onImageClick,
}: {
	generation: PersonGenerationRecord;
	onImageClick?: () => void;
}) {
	if (generation.status === "queued") {
		return (
			<div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-muted/10 dark:bg-muted/5">
				<div className="grid place-items-center gap-2">
					<Loader2 className="size-6 animate-spin text-muted-foreground/50" />
					<span className="text-muted-foreground/50 text-xs">Generating…</span>
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
	return (
		<Link
			className="group relative overflow-hidden rounded-xl bg-background/60 transition-all hover:shadow-black/5 hover:shadow-lg dark:bg-background/40 dark:hover:shadow-black/20"
			href={getHref(person.slug)}
			scroll={false}
		>
			<div className="relative aspect-[3/4] overflow-hidden">
				<Image
					alt={person.name}
					className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
					fill
					sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
					src={person.referencePhotoUrl}
				/>
				<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-16 pr-4 pb-4 pl-4">
					<h3 className="font-medium text-base text-white tracking-tight">
						{person.name}
					</h3>
					{person.description ? (
						<p className="mt-0.5 line-clamp-1 text-white/70 text-xs">
							{person.description}
						</p>
					) : null}
				</div>
			</div>
			<div className="flex items-center justify-between gap-2 px-3 py-2.5">
				<span className="text-muted-foreground text-xs">
					{person.generations.length} generation
					{person.generations.length === 1 ? "" : "s"}
				</span>
				<span className="rounded-full bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-muted/10">
					{person.slug}
				</span>
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
		<div className="grid h-full min-h-0 gap-4 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
	studioUrl,
	onImageClick,
}: {
	generation: PersonGenerationRecord;
	studioUrl: string;
	onImageClick?: () => void;
}) {
	const studioGenerationHref = buildStudioGenerationHref(studioUrl, generation);

	return (
		<div className="grid gap-2.5 rounded-xl bg-muted/8 p-3 dark:bg-muted/5">
			<GenerationPreview generation={generation} onImageClick={onImageClick} />
			<div className="grid gap-1.5">
				<div className="flex items-center justify-between gap-2">
					<h3 className="truncate text-sm">{generation.title}</h3>
					<span
						className={cn(
							"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
							generationTone[generation.status]
						)}
					>
						<GenerationStatusIcon status={generation.status} />
						{generation.status}
					</span>
				</div>
				<p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
					{generation.prompt || "Prompt not attached."}
				</p>
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="inline-flex items-center rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-muted/8">
						<GenerationMediaBadge mediaType={generation.mediaType} />
					</span>
					{studioGenerationHref ? (
						<a
							className="inline-flex items-center gap-1 rounded-full bg-muted/15 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/25 dark:bg-muted/8"
							href={studioGenerationHref}
						>
							Studio
							<ArrowUpRight className="size-3" />
						</a>
					) : null}
				</div>
			</div>
		</div>
	);
}

interface TrainingMeta {
	errorSummary?: string;
	referenceImageUrls?: string[];
	status?: string;
	triggerWord?: string;
}

function getTrainingMeta(person: PersonRecord): TrainingMeta | null {
	const training = person.metadata?.training;
	if (training && typeof training === "object" && !Array.isArray(training)) {
		return training as TrainingMeta;
	}
	return null;
}

const trainingStatusTone: Record<string, string> = {
	queued: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
	generating: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	training: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	publishing: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
	ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function LoraActions({
	person,
	onTrainLora,
	onGenerateWithLora,
}: {
	person: PersonRecord;
	onTrainLora: () => void;
	onGenerateWithLora: (
		prompt: string,
		options?: {
			extraLoraUrl?: string;
			extraLoraWeight?: number;
		}
	) => void;
}) {
	const [loraPrompt, setLoraPrompt] = useState("");
	const [extraLoraUrl, setExtraLoraUrl] = useState("");
	const [extraLoraWeight, setExtraLoraWeight] = useState("0.05");
	const training = getTrainingMeta(person);
	const hasLora = Boolean(person.loraUrl);
	const effectiveStatus =
		hasLora && training?.status !== "failed" ? "ready" : training?.status;
	const isTraining =
		!hasLora &&
		(effectiveStatus === "queued" ||
			effectiveStatus === "generating" ||
			effectiveStatus === "training" ||
			effectiveStatus === "publishing");

	return (
		<div className="grid gap-3">
			<SectionLabel>LoRA training</SectionLabel>

			{effectiveStatus ? (
				<div className="flex items-center gap-2">
					<span
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
							trainingStatusTone[effectiveStatus] ??
								"bg-muted/10 text-muted-foreground"
						)}
					>
						{isTraining ? <Loader2 className="size-3 animate-spin" /> : null}
						{effectiveStatus}
					</span>
					{training?.triggerWord ? (
						<span className="text-muted-foreground text-xs">
							trigger: {training.triggerWord}
						</span>
					) : null}
				</div>
			) : null}

			{training?.errorSummary ? (
				<p className="rounded-lg bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
					{training.errorSummary}
				</p>
			) : null}

			<Button
				disabled={isTraining}
				onClick={onTrainLora}
				size="sm"
				variant="outline"
			>
				{isTraining ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<Sparkles className="size-3.5" />
				)}
				{isTraining ? "Training..." : "Train LoRA"}
			</Button>

			{hasLora ? (
				<div className="grid gap-2">
					<Label className="text-xs" htmlFor="loraPrompt">
						Generate with LoRA
					</Label>
					<textarea
						className={textareaClassName}
						id="loraPrompt"
						onChange={(e) => setLoraPrompt(e.target.value)}
						placeholder="portrait photo, studio lighting..."
						value={loraPrompt}
					/>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="extraLoraUrl">
							Optional extra LoRA URL
						</Label>
						<Input
							id="extraLoraUrl"
							onChange={(event) => setExtraLoraUrl(event.target.value)}
							placeholder="https://.../zit-mystic.safetensors"
							value={extraLoraUrl}
						/>
						<p className="text-[11px] text-muted-foreground/70">
							Use for additive LoRAs such as{" "}
							<a
								className="underline"
								href="https://civitai.red/models/2206377/zit-mystic-xxx"
								rel="noreferrer noopener"
								target="_blank"
							>
								ZIT Mystic XXX
							</a>
							.
						</p>
					</div>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="extraLoraWeight">
							Optional extra LoRA weight
						</Label>
						<Input
							id="extraLoraWeight"
							onChange={(event) => setExtraLoraWeight(event.target.value)}
							placeholder="0.05"
							value={extraLoraWeight}
						/>
					</div>
					<Button
						disabled={!loraPrompt.trim()}
						onClick={() => {
							const parsedExtraLoraWeight = Number.parseFloat(extraLoraWeight);
							onGenerateWithLora(loraPrompt.trim(), {
								extraLoraUrl: extraLoraUrl.trim() || undefined,
								extraLoraWeight: Number.isFinite(parsedExtraLoraWeight)
									? parsedExtraLoraWeight
									: 0.05,
							});
							setLoraPrompt("");
						}}
						size="sm"
					>
						<Sparkles className="size-3.5" />
						Generate with LoRA
					</Button>
				</div>
			) : null}
		</div>
	);
}

const DATASET_TARGET_COUNT = 20;

function DatasetGallery({
	isGenerating,
	urls,
	onImageClick,
}: {
	isGenerating: boolean;
	urls: string[];
	onImageClick: (index: number) => void;
}) {
	if (urls.length === 0 && !isGenerating) {
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
						Generating dataset… {urls.length} / {DATASET_TARGET_COUNT}
					</span>
				</div>
			) : null}
			{urls.length > 0 ? (
				<div className="grid grid-cols-4 gap-2 sm:grid-cols-5 xl:grid-cols-6">
					{urls.map((url, i) => (
						<button
							aria-label={`View reference ${i + 1}`}
							className="relative aspect-[3/4] overflow-hidden rounded-lg transition hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							key={url}
							onClick={() => onImageClick(i)}
							type="button"
						>
							<Image
								alt={`Reference ${i + 1}`}
								className="object-cover"
								fill
								sizes="(max-width: 768px) 25vw, 120px"
								src={url}
							/>
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

type DetailTab = "generations" | "dataset";

function PersonDetailView({
	backHref,
	person,
	studioUrl,
	onTrainLora,
	onGenerateWithLora,
}: {
	backHref: Route;
	person: PersonRecord;
	studioUrl: string;
	onTrainLora: () => void;
	onGenerateWithLora: (prompt: string) => void;
}) {
	const [activeTab, setActiveTab] = useState<DetailTab>("generations");
	const [lightbox, setLightbox] = useState<LightboxState | null>(null);
	const trainingMeta = getTrainingMeta(person);
	const isGeneratingDataset = trainingMeta?.status === "generating";
	const generations = person.generations.filter(
		(g) => g.metadata.isDatasetPhoto !== true
	);
	const datasetPhotos = person.generations.filter(
		(g) => g.metadata.isDatasetPhoto === true
	);
	const datasetUrls =
		datasetPhotos.length > 0
			? datasetPhotos.map((g) => g.sourceUrl)
			: (trainingMeta?.referenceImageUrls ?? []);

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

	return (
		<div className="grid h-full min-h-0 gap-4 overflow-y-auto">
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

			<div className="flex items-center gap-3">
				<Link
					className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted/20 hover:text-foreground"
					href={backHref}
					scroll={false}
				>
					<ArrowLeft className="size-4" />
				</Link>
				<div className="min-w-0">
					<h2 className="truncate font-medium text-lg tracking-tight">
						{person.name}
					</h2>
					<p className="text-muted-foreground text-xs">{person.slug}</p>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
				<div className="grid gap-3">
					<button
						aria-label={`View ${person.name} reference photo`}
						className="relative aspect-[3/4] overflow-hidden rounded-xl transition hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={openReferenceLightbox}
						type="button"
					>
						<Image
							alt={person.name}
							className="object-cover"
							fill
							priority
							sizes="(max-width: 1024px) 100vw, 320px"
							src={person.referencePhotoUrl}
						/>
					</button>
					{person.description ? (
						<p className="text-muted-foreground text-sm leading-relaxed">
							{person.description}
						</p>
					) : null}
				</div>

				<div className="grid content-start gap-2">
					<SectionLabel className="mb-1">Assets</SectionLabel>
					<PersonAsset
						href={person.datasetUrl}
						icon={FolderArchive}
						label="Dataset"
						value="Open"
					/>
					<PersonAsset
						href={person.loraUrl}
						icon={Sparkles}
						label="LoRA"
						value="Open"
					/>
					<PersonAsset
						href={person.photoUrl}
						icon={ImageIcon}
						label="Photo"
						value="Open"
					/>
					<PersonAsset
						href={person.videoUrl}
						icon={Clapperboard}
						label="Video"
						value="Open"
					/>
					<PersonAsset
						href={person.voiceWavUrl}
						icon={AudioWaveform}
						label="Voice WAV"
						value="Open"
					/>
				</div>
			</div>

			<LoraActions
				onGenerateWithLora={onGenerateWithLora}
				onTrainLora={onTrainLora}
				person={person}
			/>

			<div className="grid gap-3">
				<div className="flex items-center gap-1 border-foreground/6 border-b dark:border-foreground/10">
					<button
						className={cn(
							"-mb-px border-b-2 px-3 py-2 text-sm transition",
							activeTab === "generations"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground"
						)}
						onClick={() => setActiveTab("generations")}
						type="button"
					>
						Generations
						{generations.length > 0 ? (
							<span className="ml-1.5 text-muted-foreground text-xs">
								{generations.length}
							</span>
						) : null}
					</button>
					<button
						className={cn(
							"-mb-px border-b-2 px-3 py-2 text-sm transition",
							activeTab === "dataset"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground"
						)}
						onClick={() => setActiveTab("dataset")}
						type="button"
					>
						Dataset
						{datasetUrls.length > 0 ? (
							<span className="ml-1.5 text-muted-foreground text-xs">
								{datasetUrls.length}
							</span>
						) : null}
					</button>
				</div>

				{activeTab === "generations" && generations.length > 0 ? (
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{generations.map((generation) => (
							<GenerationCard
								generation={generation}
								key={generation.id}
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
						onImageClick={openDatasetLightbox}
						urls={datasetUrls}
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

function CreatePersonForm({
	formState,
	isCreating,
	onFieldChange,
	onSubmit,
}: {
	formState: CreatePersonInput;
	isCreating: boolean;
	onFieldChange: <Key extends keyof CreatePersonInput>(
		key: Key,
		value: CreatePersonInput[Key]
	) => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
	const [showMore, setShowMore] = useState(false);

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
							<Label className="text-xs" htmlFor="description">
								Description
							</Label>
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
							Create
						</Button>
						{willRunPipeline(formState) ? (
							<p className="text-center text-[11px] text-muted-foreground/60">
								LoRA pipeline will run automatically
							</p>
						) : null}
					</form>
				</div>
			</div>
		</WorkspacePane>
	);
}

export default function PersonsWorkspace({
	initialSnapshot,
}: {
	initialSnapshot: { persons: PersonRecord[]; warnings: string[] };
}) {
	const [persons, setPersons] = useState(initialSnapshot.persons);
	const [formState, setFormState] = useState<CreatePersonInput>(
		createEmptyFormState()
	);
	const [isCreating, startCreateTransition] = useTransition();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const currentSearch = searchParams.toString();
	const requestedPersonSlug = searchParams.get("person");

	const selectedPerson = requestedPersonSlug
		? (persons.find((person) => person.slug === requestedPersonSlug) ?? null)
		: null;

	const needsPolling =
		persons.some((person) =>
			person.generations.some((generation) => generation.status === "queued")
		) ||
		persons.some((person) => {
			const t = person.metadata?.training;
			if (t && typeof t === "object" && !Array.isArray(t)) {
				const status = (t as Record<string, unknown>).status;
				return (
					status === "queued" ||
					status === "generating" ||
					status === "training" ||
					status === "publishing"
				);
			}
			return false;
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
	const adminUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
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

	function handleCreatePerson(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		startCreateTransition(async () => {
			try {
				const nextPerson = await createPerson(formState);
				setPersons((current) => [nextPerson, ...current]);
				router.push(
					buildPersonsHref(pathname, currentSearch, nextPerson.slug),
					{ scroll: false }
				);
				setFormState(createEmptyFormState());
				toast.success("Person created");

				if (willRunPipeline(formState)) {
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
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Unable to create person"
				);
			}
		});
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
			extraLoraUrl?: string;
			extraLoraWeight?: number;
		}
	) {
		if (!selectedPerson) {
			return;
		}
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
			toast.error(
				error instanceof Error ? error.message : "Failed to start generation"
			);
		}
	}

	function getPersonHref(personSlug: string) {
		return buildPersonsHref(pathname, currentSearch, personSlug);
	}

	const backHref = buildPersonsHref(pathname, currentSearch, null);

	return (
		<WorkspaceShell
			inspector={
				<CreatePersonForm
					formState={formState}
					isCreating={isCreating}
					onFieldChange={updateFormField}
					onSubmit={handleCreatePerson}
				/>
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
				</>
			}
			subtitle={
				selectedPerson
					? `${selectedPerson.slug} · ${selectedPerson.generations.length} generations`
					: "Reusable cast workspace"
			}
			title={selectedPerson?.name ?? "Cast"}
			workspaceLabel="Persons"
		>
			{selectedPerson ? (
				<PersonDetailView
					backHref={backHref}
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
