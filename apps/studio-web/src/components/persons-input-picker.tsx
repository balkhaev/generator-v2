"use client";

import type {
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";
import type { UploadedInputAsset } from "@generator/studio-client/client";
import { uploadStudioInputImage } from "@generator/studio-client/client";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { SectionLabel } from "@generator/ui/components/section-label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import {
	ArrowRight,
	ImageUp,
	Link as LinkIcon,
	Loader2,
	Search,
	Sparkles,
	Trash2,
	type Upload,
	UsersRound,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
	generatePersonWithLora,
	getPersonById,
	listPersons,
} from "@/lib/persons-api";

export interface PersonInputPick {
	personGenerationId?: string | null;
	personId?: string | null;
	storage?: UploadedInputAsset["storage"] | null;
	url: string;
}

type PickerTab = "upload" | "url" | "recent" | "persons";

const tabs: { icon: typeof Upload; id: PickerTab; label: string }[] = [
	{ icon: ImageUp, id: "upload", label: "Upload" },
	{ icon: LinkIcon, id: "url", label: "URL" },
	{ icon: ArrowRight, id: "recent", label: "Recent" },
	{ icon: UsersRound, id: "persons", label: "Persons" },
];

const previewableUrlPattern = /^(https?:\/\/.{3,}|data:\w+\/)/;

interface RecentReference {
	id: string;
	label: string;
	url: string;
}

export interface PersonsInputPickerProps {
	className?: string;
	currentUrl: string;
	onPick: (pick: PersonInputPick) => void;
	recentReferences: RecentReference[];
	storageLabel?: string | null;
}

export default function PersonsInputPicker({
	className,
	currentUrl,
	onPick,
	recentReferences,
	storageLabel,
}: PersonsInputPickerProps) {
	const [activeTab, setActiveTab] = useState<PickerTab>("upload");
	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgressPct, setUploadProgressPct] = useState(0);
	const [persons, setPersons] = useState<PersonRecord[]>([]);
	const [isLoadingPersons, setIsLoadingPersons] = useState(false);
	const [personsError, setPersonsError] = useState<string | null>(null);
	const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
	const [personDetail, setPersonDetail] = useState<PersonRecord | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [generationPrompt, setGenerationPrompt] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);
	const [pollAttempts, setPollAttempts] = useState(0);
	const fileInputId = useId();
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const hasValidPreview = previewableUrlPattern.test(currentUrl);

	useEffect(() => {
		if (activeTab !== "persons" || persons.length > 0) {
			return;
		}
		setIsLoadingPersons(true);
		setPersonsError(null);
		listPersons()
			.then((result) => {
				setPersons(result.persons);
				if (result.warnings.length > 0) {
					setPersonsError(result.warnings[0]);
				}
			})
			.catch((error) => {
				setPersonsError(
					error instanceof Error ? error.message : "Failed to load persons"
				);
			})
			.finally(() => {
				setIsLoadingPersons(false);
			});
	}, [activeTab, persons.length]);

	useEffect(() => {
		if (!selectedPersonId) {
			setPersonDetail(null);
			return;
		}
		const cached = persons.find((person) => person.id === selectedPersonId);
		if (cached) {
			setPersonDetail(cached);
		}
		getPersonById(selectedPersonId)
			.then((person) => {
				setPersonDetail(person);
			})
			.catch(() => undefined);
	}, [persons, selectedPersonId]);

	useEffect(
		() => () => {
			if (pollTimeoutRef.current) {
				clearTimeout(pollTimeoutRef.current);
			}
		},
		[]
	);

	const filteredPersons = useMemo(() => {
		if (!searchQuery.trim()) {
			return persons;
		}
		const lowered = searchQuery.toLowerCase();
		return persons.filter(
			(person) =>
				person.name.toLowerCase().includes(lowered) ||
				person.slug.toLowerCase().includes(lowered)
		);
	}, [persons, searchQuery]);

	async function handleUpload(file: File) {
		setIsUploading(true);
		setUploadProgressPct(0);
		try {
			const uploaded = await uploadStudioInputImage({
				file,
				onProgress: setUploadProgressPct,
			});
			onPick({
				personGenerationId: null,
				personId: null,
				storage: uploaded.storage,
				url: uploaded.url,
			});
			toast.success("Input image uploaded.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to upload image."
			);
		} finally {
			setIsUploading(false);
		}
	}

	function pickFromPersonGeneration(
		person: PersonRecord,
		generation: PersonGenerationRecord
	) {
		const url = generation.previewUrl ?? generation.sourceUrl;
		if (!url) {
			toast.error("Generation has no usable image yet.");
			return;
		}
		onPick({
			personGenerationId: generation.id,
			personId: person.id,
			storage: null,
			url,
		});
	}

	function pickFromPersonReference(person: PersonRecord) {
		const url = person.photoUrl ?? person.referencePhotoUrl;
		if (!url) {
			toast.error("Person has no reference photo.");
			return;
		}
		onPick({
			personGenerationId: null,
			personId: person.id,
			storage: null,
			url,
		});
	}

	async function pollForNewGeneration(
		personId: string,
		knownIds: Set<string>,
		attempt = 0
	) {
		if (attempt > 30) {
			setIsGenerating(false);
			setPollAttempts(0);
			toast.message("Generation still running. Open Cast to follow up.");
			return;
		}
		setPollAttempts(attempt + 1);
		try {
			const fresh = await getPersonById(personId);
			setPersonDetail(fresh);
			const newReady = fresh.generations.find(
				(generation) =>
					!knownIds.has(generation.id) && generation.status === "ready"
			);
			if (newReady) {
				setIsGenerating(false);
				setPollAttempts(0);
				pickFromPersonGeneration(fresh, newReady);
				toast.success("New generation ready.");
				return;
			}
		} catch {
			// keep polling
		}
		pollTimeoutRef.current = setTimeout(() => {
			pollForNewGeneration(personId, knownIds, attempt + 1).catch(
				() => undefined
			);
		}, 2000);
	}

	async function handleGenerateWithLora() {
		if (!personDetail) {
			return;
		}
		const prompt = generationPrompt.trim();
		if (!prompt) {
			toast.error("Add a prompt for LoRA generation.");
			return;
		}
		if (!personDetail.loraUrl) {
			toast.error("This person has no trained LoRA yet.");
			return;
		}
		setIsGenerating(true);
		const knownIds = new Set(
			personDetail.generations.map((generation) => generation.id)
		);
		try {
			const updated = await generatePersonWithLora(personDetail.id, prompt);
			setPersonDetail(updated);
			pollForNewGeneration(updated.id, knownIds).catch(() => undefined);
		} catch (error) {
			setIsGenerating(false);
			toast.error(
				error instanceof Error
					? error.message
					: "Unable to start LoRA generation."
			);
		}
	}

	function renderTabHeader() {
		return (
			<div className="flex items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-1">
					{tabs.map((tab) => {
						const Icon = tab.icon;
						const isActive = tab.id === activeTab;
						return (
							<button
								aria-pressed={isActive}
								className={cn(
									"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition",
									isActive
										? "bg-foreground text-background"
										: "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
								)}
								key={tab.id}
								onClick={() => setActiveTab(tab.id)}
								type="button"
							>
								<Icon className="size-3" />
								{tab.label}
							</button>
						);
					})}
				</div>
				{storageLabel ? (
					<span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
						{storageLabel}
					</span>
				) : null}
			</div>
		);
	}

	function renderPreview() {
		if (!hasValidPreview) {
			return null;
		}
		return (
			<div className="group relative overflow-hidden rounded-xl border border-foreground/8">
				<div
					className="aspect-video bg-center bg-cover bg-muted/10 bg-no-repeat"
					style={{
						backgroundImage: `url("${currentUrl}")`,
					}}
				/>
				<div className="absolute inset-x-0 bottom-0 flex items-end justify-end gap-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-8 pb-2">
					<button
						aria-label="Clear input image"
						className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-rose-500/60"
						onClick={() => {
							onPick({
								personGenerationId: null,
								personId: null,
								storage: null,
								url: "",
							});
						}}
						type="button"
					>
						<Trash2 className="size-3" />
					</button>
				</div>
			</div>
		);
	}

	function renderUploadTab() {
		return (
			<div className="grid gap-2">
				<input
					accept="image/*"
					className="sr-only"
					id={fileInputId}
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) {
							handleUpload(file).catch(() => undefined);
						}
						event.target.value = "";
					}}
					ref={fileInputRef}
					type="file"
				/>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone */}
				{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: drop zone */}
				<div
					className="grid gap-3 rounded-xl border border-foreground/10 border-dashed px-3 py-4 transition hover:border-foreground/20 hover:bg-muted/5"
					onDragOver={(event) => event.preventDefault()}
					onDrop={(event) => {
						event.preventDefault();
						const file = event.dataTransfer.files?.[0];
						if (file) {
							handleUpload(file).catch(() => undefined);
						}
					}}
				>
					<button
						className="flex items-center gap-2.5 text-left"
						onClick={() => fileInputRef.current?.click()}
						type="button"
					>
						<div className="flex size-9 items-center justify-center rounded-lg bg-muted/15 dark:bg-muted/10">
							{isUploading ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<ImageUp className="size-4 text-muted-foreground" />
							)}
						</div>
						<div className="min-w-0">
							<p className="text-xs">Upload or drop image</p>
							<p className="text-[11px] text-muted-foreground">
								PNG, JPG, WEBP, GIF, AVIF
							</p>
						</div>
					</button>
					{isUploading ? (
						<div className="grid gap-1">
							<div className="h-1 overflow-hidden rounded-full bg-foreground/8">
								<div
									className="h-full rounded-full bg-foreground transition-[width]"
									style={{ width: `${uploadProgressPct}%` }}
								/>
							</div>
							<p className="text-[11px] text-muted-foreground">
								{uploadProgressPct}%
							</p>
						</div>
					) : null}
				</div>
			</div>
		);
	}

	function renderUrlTab() {
		return (
			<div className="grid gap-2">
				<Input
					onChange={(event) => {
						onPick({
							personGenerationId: null,
							personId: null,
							storage: null,
							url: event.target.value,
						});
					}}
					placeholder="https://..."
					value={currentUrl}
				/>
				<p className="text-[11px] text-muted-foreground">
					Paste a direct URL to any image. Storage will be marked as remote.
				</p>
			</div>
		);
	}

	function renderRecentTab() {
		if (recentReferences.length === 0) {
			return (
				<p className="rounded-lg bg-muted/10 px-3 py-3 text-center text-[11px] text-muted-foreground dark:bg-muted/5">
					No recent inputs yet.
				</p>
			);
		}
		return (
			<div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto py-0.5">
				{recentReferences.map((reference) => {
					const isActive = currentUrl === reference.url;
					return (
						<Tooltip key={reference.id}>
							<TooltipTrigger
								render={
									<button
										aria-label={reference.label}
										className={cn(
											"group relative aspect-square overflow-hidden rounded-lg transition",
											isActive
												? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
												: "opacity-70 hover:opacity-100"
										)}
										onClick={() =>
											onPick({
												personGenerationId: null,
												personId: null,
												storage: null,
												url: reference.url,
											})
										}
										type="button"
									/>
								}
							>
								<div
									aria-hidden="true"
									className="absolute inset-0 bg-center bg-cover"
									style={{ backgroundImage: `url("${reference.url}")` }}
								/>
								<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pt-3 pb-1">
									<p className="truncate text-center text-[10px] text-white leading-tight">
										{reference.label}
									</p>
								</div>
							</TooltipTrigger>
							<TooltipContent>{reference.label}</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		);
	}

	function renderPersonsList() {
		if (isLoadingPersons) {
			return (
				<div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
					<Loader2 className="size-3 animate-spin" /> Loading persons…
				</div>
			);
		}
		if (filteredPersons.length === 0) {
			return (
				<p className="rounded-lg bg-muted/10 px-3 py-3 text-center text-[11px] text-muted-foreground dark:bg-muted/5">
					{personsError ?? "No persons yet."}
				</p>
			);
		}
		return (
			<div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
				{filteredPersons.map((person) => {
					const isActive = selectedPersonId === person.id;
					const thumbnail = person.photoUrl ?? person.referencePhotoUrl ?? null;
					return (
						<button
							className={cn(
								"group relative aspect-square overflow-hidden rounded-lg transition",
								isActive
									? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
									: "opacity-80 hover:opacity-100"
							)}
							key={person.id}
							onClick={() => setSelectedPersonId(person.id)}
							type="button"
						>
							{thumbnail ? (
								<div
									aria-hidden="true"
									className="absolute inset-0 bg-center bg-cover"
									style={{ backgroundImage: `url("${thumbnail}")` }}
								/>
							) : (
								<div className="absolute inset-0 bg-muted/20" />
							)}
							<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 pt-3 pb-1">
								<p className="truncate text-center text-[10px] text-white leading-tight">
									{person.name}
								</p>
							</div>
						</button>
					);
				})}
			</div>
		);
	}

	function renderPersonDetail() {
		if (!personDetail) {
			return null;
		}
		const readyGenerations = personDetail.generations.filter(
			(generation) =>
				generation.status === "ready" &&
				(generation.previewUrl ?? generation.sourceUrl)
		);
		const hasLora = Boolean(personDetail.loraUrl);

		return (
			<div className="grid gap-3 rounded-xl bg-muted/8 p-3 dark:bg-muted/4">
				<div className="flex items-center justify-between gap-2">
					<div className="min-w-0">
						<p className="truncate text-xs">{personDetail.name}</p>
						<p className="truncate text-[11px] text-muted-foreground">
							{personDetail.slug} {hasLora ? "· LoRA ready" : "· no LoRA yet"}
						</p>
					</div>
					<Button
						onClick={() => pickFromPersonReference(personDetail)}
						size="xs"
						variant="outline"
					>
						Reference
					</Button>
				</div>

				{readyGenerations.length > 0 ? (
					<div className="grid gap-1.5">
						<SectionLabel>Generations</SectionLabel>
						<div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto">
							{readyGenerations.map((generation) => {
								const url = generation.previewUrl ?? generation.sourceUrl ?? "";
								const isActive = currentUrl === url;
								return (
									<button
										aria-label={generation.title}
										className={cn(
											"relative aspect-square overflow-hidden rounded-lg transition",
											isActive
												? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
												: "opacity-80 hover:opacity-100"
										)}
										key={generation.id}
										onClick={() =>
											pickFromPersonGeneration(personDetail, generation)
										}
										type="button"
									>
										<div
											aria-hidden="true"
											className="absolute inset-0 bg-center bg-cover"
											style={{ backgroundImage: `url("${url}")` }}
										/>
									</button>
								);
							})}
						</div>
					</div>
				) : (
					<p className="rounded-lg bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground dark:bg-muted/5">
						No ready generations yet.
					</p>
				)}

				<div className="grid gap-1.5">
					<SectionLabel>Generate with LoRA</SectionLabel>
					<Input
						disabled={!hasLora || isGenerating}
						onChange={(event) => setGenerationPrompt(event.target.value)}
						placeholder={
							hasLora ? "Describe the new shot…" : "Train LoRA first in Cast"
						}
						value={generationPrompt}
					/>
					<Button
						disabled={!hasLora || isGenerating || !generationPrompt.trim()}
						onClick={() => {
							handleGenerateWithLora().catch(() => undefined);
						}}
						size="xs"
					>
						{isGenerating ? (
							<>
								<Loader2 className="size-3 animate-spin" />
								Polling… ({pollAttempts}/30)
							</>
						) : (
							<>
								<Sparkles className="size-3" />
								Generate
							</>
						)}
					</Button>
				</div>
			</div>
		);
	}

	function renderPersonsTab() {
		return (
			<div className="grid gap-2">
				<div className="relative">
					<Search
						aria-hidden="true"
						className="absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						className="pl-7"
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="Search persons…"
						value={searchQuery}
					/>
				</div>
				{renderPersonsList()}
				{renderPersonDetail()}
			</div>
		);
	}

	function renderActiveTab() {
		switch (activeTab) {
			case "upload":
				return renderUploadTab();
			case "url":
				return renderUrlTab();
			case "recent":
				return renderRecentTab();
			case "persons":
				return renderPersonsTab();
			default:
				return null;
		}
	}

	return (
		<div className={cn("grid gap-2", className)}>
			{renderTabHeader()}
			{renderPreview()}
			{renderActiveTab()}
		</div>
	);
}
