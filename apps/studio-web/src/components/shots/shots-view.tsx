"use client";

import type {
	PersonGenerationRecord,
	PersonRecord,
} from "@generator/contracts/persons";
import { env } from "@generator/env/web";
import type { ScenarioShotRecord } from "@generator/studio-client/client";
import { deleteStudioShot } from "@generator/studio-client/client";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import WorkspaceShell, {
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import {
	ExternalLink,
	Image as ImageIcon,
	Layers,
	Loader2,
	Play,
	Search,
	Sparkles,
	Trash2,
	UsersRound,
	Video,
	Wand2,
} from "lucide-react";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";

import { ModeToggle } from "@/components/mode-toggle";
import ShotsLightbox, {
	type LightboxItem,
} from "@/components/shots/shots-lightbox";
import UserMenu from "@/components/user-menu";

type FeedKind = "studio" | "person" | "dataset";
type TabId = "all" | FeedKind;

interface FeedItem extends LightboxItem {
	kind: FeedKind;
	thumbnailUrl: string;
}

const studioShotIdPrefix = /^shot-/;

function isPersonDatasetGeneration(generation: PersonGenerationRecord) {
	return generation.metadata?.isDatasetPhoto === true;
}

function buildStudioItems(shots: ScenarioShotRecord[]): FeedItem[] {
	return shots.map<FeedItem>((shot) => {
		const isVideo = shot.artifactKind === "video";
		return {
			artifactKind: isVideo ? "video" : "image",
			badge: "Studio",
			createdAt: shot.createdAt,
			description: shot.note?.trim() ? shot.note.trim() : null,
			fullUrl: shot.artifactUrl,
			id: `shot-${shot.id}`,
			kind: "studio",
			openHref: shot.artifactUrl,
			personName: null,
			scenarioName: shot.scenarioName,
			subtitle: shot.scenarioName,
			thumbnailUrl: shot.artifactUrl,
			title: shot.note?.trim() ? shot.note.trim() : shot.scenarioName,
		};
	});
}

function buildPersonItems(
	persons: PersonRecord[],
	personsBaseUrl: string
): FeedItem[] {
	const items: FeedItem[] = [];
	for (const person of persons) {
		for (const generation of person.generations) {
			if (isPersonDatasetGeneration(generation)) {
				continue;
			}
			const url = generation.previewUrl ?? generation.sourceUrl;
			if (!url) {
				continue;
			}
			const isVideo = generation.mediaType === "video";
			items.push({
				artifactKind: isVideo ? "video" : "image",
				badge: "Cast",
				createdAt: generation.createdAt,
				description: generation.prompt?.trim()
					? generation.prompt.trim()
					: null,
				fullUrl: generation.sourceUrl ?? url,
				id: `person-${generation.id}`,
				kind: "person",
				openHref: `${personsBaseUrl}/${person.slug}`,
				personName: person.name,
				scenarioName: generation.title,
				subtitle: `${person.name} · ${generation.title}`,
				thumbnailUrl: url,
				title: generation.title,
			});
		}
	}
	return items;
}

function buildDatasetItems(
	persons: PersonRecord[],
	personsBaseUrl: string
): FeedItem[] {
	const items: FeedItem[] = [];
	for (const person of persons) {
		const datasetPhotos = person.generations.filter(isPersonDatasetGeneration);
		for (const generation of datasetPhotos) {
			const url = generation.previewUrl ?? generation.sourceUrl;
			if (!url) {
				continue;
			}
			items.push({
				artifactKind: "image",
				badge: "Dataset",
				createdAt: generation.createdAt,
				description: generation.prompt?.trim()
					? generation.prompt.trim()
					: null,
				fullUrl: generation.sourceUrl ?? url,
				id: `dataset-${generation.id}`,
				kind: "dataset",
				openHref: `${personsBaseUrl}/${person.slug}`,
				personName: person.name,
				scenarioName: null,
				subtitle: person.name,
				thumbnailUrl: url,
				title: person.name,
			});
		}
	}
	return items;
}

function sortByDateDesc(left: FeedItem, right: FeedItem) {
	return right.createdAt.localeCompare(left.createdAt);
}

interface FeedTileProps {
	deletingId: string | null;
	item: FeedItem;
	onDelete: (item: FeedItem) => void;
	onOpen: (id: string) => void;
}

function FeedTile({ deletingId, item, onDelete, onOpen }: FeedTileProps) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const isVideo = item.artifactKind === "video";

	const handlePointerEnter = useCallback(
		(_event: ReactPointerEvent<HTMLElement>) => {
			if (!videoRef.current) {
				return;
			}
			videoRef.current.currentTime = 0;
			videoRef.current.play().catch(() => undefined);
		},
		[]
	);

	const handlePointerLeave = useCallback(() => {
		if (!videoRef.current) {
			return;
		}
		videoRef.current.pause();
		videoRef.current.currentTime = 0;
	}, []);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLElement>) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				onOpen(item.id);
			}
		},
		[item.id, onOpen]
	);

	const isDeleting = deletingId === item.id;
	const allowDelete = item.kind === "studio";

	return (
		<article
			className="group relative overflow-hidden rounded-xl border border-foreground/8 bg-muted/5 transition focus-within:ring-2 focus-within:ring-ring/60 hover:border-foreground/20 hover:shadow-lg"
			onPointerEnter={isVideo ? handlePointerEnter : undefined}
			onPointerLeave={isVideo ? handlePointerLeave : undefined}
		>
			<button
				aria-label={`Открыть ${item.title}`}
				className="block w-full cursor-zoom-in text-left outline-none"
				onClick={() => onOpen(item.id)}
				onKeyDown={handleKeyDown}
				type="button"
			>
				{isVideo ? (
					<video
						className="aspect-[9/16] w-full bg-black/40 object-cover"
						loop
						muted
						playsInline
						preload="metadata"
						ref={videoRef}
						src={item.thumbnailUrl}
					>
						<track kind="captions" />
					</video>
				) : (
					<div
						aria-hidden="true"
						className="aspect-[9/16] bg-center bg-cover"
						style={{
							backgroundImage: `url("${item.thumbnailUrl}")`,
						}}
					/>
				)}
			</button>

			<div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5">
				<span className="inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 font-medium text-[10px] text-foreground/80 uppercase tracking-wide backdrop-blur-md">
					{isVideo ? (
						<Video className="size-3" />
					) : (
						<ImageIcon className="size-3" />
					)}
					{item.badge}
				</span>
			</div>

			{isVideo ? (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-90 transition-opacity duration-200 group-hover:opacity-0"
				>
					<span className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-md">
						<Play className="size-5 translate-x-[1px] fill-current" />
					</span>
				</div>
			) : null}

			<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pt-10 pb-2 opacity-90 transition-opacity duration-200 group-hover:opacity-100">
				<div className="min-w-0 text-white">
					<p className="truncate font-medium text-[11px] leading-tight">
						{item.title}
					</p>
					<p className="truncate text-[10px] text-white/70">
						{item.subtitle} · {formatRelativeTime(item.createdAt)}
					</p>
				</div>
				<div className="pointer-events-auto flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger
							render={
								<a
									aria-label="Открыть оригинал"
									className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
									href={item.openHref}
									onClick={(event) => event.stopPropagation()}
									rel="noreferrer"
									target="_blank"
								>
									<ExternalLink className="size-3" />
								</a>
							}
						/>
						<TooltipContent>Открыть оригинал</TooltipContent>
					</Tooltip>
					{allowDelete ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										aria-label="Удалить shot"
										className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-rose-500/60 disabled:opacity-50"
										disabled={isDeleting}
										onClick={(event) => {
											event.stopPropagation();
											onDelete(item);
										}}
										type="button"
									>
										{isDeleting ? (
											<Loader2 className="size-3 animate-spin" />
										) : (
											<Trash2 className="size-3" />
										)}
									</button>
								}
							/>
							<TooltipContent>Удалить</TooltipContent>
						</Tooltip>
					) : null}
				</div>
			</div>
		</article>
	);
}

interface TabDescriptor {
	emptyHint: string;
	icon: typeof ImageIcon;
	id: TabId;
	label: string;
}

const tabDescriptors: TabDescriptor[] = [
	{
		emptyHint:
			"Сохраняйте кадры из студии или импортируйте генерации в персонажей.",
		icon: Sparkles,
		id: "all",
		label: "Все",
	},
	{
		emptyHint: "Сохраняйте кадры из превью студии, чтобы они появились здесь.",
		icon: Wand2,
		id: "studio",
		label: "Studio",
	},
	{
		emptyHint: "Запустите сценарий с персонажем, чтобы увидеть результаты тут.",
		icon: UsersRound,
		id: "person",
		label: "Cast",
	},
	{
		emptyHint:
			"Datasets появятся, когда вы загрузите референс-фото или сгенерируете dataset для LoRA-тренировки.",
		icon: Layers,
		id: "dataset",
		label: "Datasets",
	},
];

const tabsById = new Map(tabDescriptors.map((tab) => [tab.id, tab]));

interface ShotsToolbarProps {
	activeTab: TabId;
	counts: Record<TabId, number>;
	onSearchChange: (value: string) => void;
	onTabChange: (tab: TabId) => void;
	searchQuery: string;
}

function ShotsToolbar({
	activeTab,
	counts,
	onSearchChange,
	onTabChange,
	searchQuery,
}: ShotsToolbarProps) {
	return (
		<div
			aria-label="Фильтр кадров"
			className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/8 bg-background/80 px-2 py-2 backdrop-blur-xl dark:bg-background/60"
			role="tablist"
		>
			<div className="flex flex-wrap items-center gap-1">
				{tabDescriptors.map((tab) => {
					const isActive = activeTab === tab.id;
					const count = counts[tab.id];
					const Icon = tab.icon;
					return (
						<button
							aria-controls="shots-feed"
							aria-selected={isActive}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60",
								isActive
									? "bg-foreground text-background shadow-sm"
									: "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							)}
							key={tab.id}
							onClick={() => onTabChange(tab.id)}
							role="tab"
							type="button"
						>
							<Icon className="size-3.5" strokeWidth={1.75} />
							{tab.label}
							<span
								className={cn(
									"rounded-full px-1.5 text-[10px] tabular-nums",
									isActive
										? "bg-background/20 text-background"
										: "bg-foreground/10 text-muted-foreground"
								)}
							>
								{count}
							</span>
						</button>
					);
				})}
			</div>
			<div className="relative w-full max-w-xs">
				<Search
					aria-hidden="true"
					className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					className="pl-8"
					onChange={(event) => onSearchChange(event.target.value)}
					placeholder="Поиск по имени, сценарию, промпту…"
					value={searchQuery}
				/>
			</div>
		</div>
	);
}

interface ShotsEmptyStateProps {
	activeTab: TabId;
	hasSearch: boolean;
}

function ShotsEmptyStateBlock({ activeTab, hasSearch }: ShotsEmptyStateProps) {
	const tab = tabsById.get(activeTab) ?? tabsById.get("all");
	const Icon = tab?.icon ?? Sparkles;
	const message = hasSearch
		? "Ничего не найдено по запросу."
		: "Здесь пока пусто.";
	return (
		<EmptyState
			hint={
				hasSearch ? "Попробуйте изменить запрос или фильтр." : tab?.emptyHint
			}
			icon={Icon}
			message={message}
		/>
	);
}

export default function ShotsView({
	persons,
	sessionEmail,
	sessionName,
	shots,
	warnings,
}: {
	persons: PersonRecord[];
	sessionEmail?: string | null;
	sessionName: string;
	shots: ScenarioShotRecord[];
	warnings: string[];
}) {
	const adminUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";

	useEffect(() => {
		document.body.classList.add("shots-route");
		return () => {
			document.body.classList.remove("shots-route");
		};
	}, []);

	const [activeTab, setActiveTab] = useState<TabId>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [studioShots, setStudioShots] = useState(shots);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [lightboxId, setLightboxId] = useState<string | null>(null);

	useEffect(() => {
		setStudioShots(shots);
	}, [shots]);

	const allItems = useMemo<FeedItem[]>(() => {
		const studio = buildStudioItems(studioShots);
		const person = buildPersonItems(persons, personsUrl);
		const dataset = buildDatasetItems(persons, personsUrl);
		return [...studio, ...person, ...dataset].sort(sortByDateDesc);
	}, [persons, personsUrl, studioShots]);

	const counts = useMemo(() => {
		const next: Record<TabId, number> = {
			all: allItems.length,
			dataset: 0,
			person: 0,
			studio: 0,
		};
		for (const item of allItems) {
			next[item.kind] += 1;
		}
		return next;
	}, [allItems]);

	const filteredItems = useMemo(() => {
		const lowered = searchQuery.trim().toLowerCase();
		return allItems.filter((item) => {
			if (activeTab !== "all" && item.kind !== activeTab) {
				return false;
			}
			if (!lowered) {
				return true;
			}
			return (
				item.title.toLowerCase().includes(lowered) ||
				item.subtitle.toLowerCase().includes(lowered) ||
				(item.personName ?? "").toLowerCase().includes(lowered) ||
				(item.scenarioName ?? "").toLowerCase().includes(lowered) ||
				(item.description ?? "").toLowerCase().includes(lowered)
			);
		});
	}, [activeTab, allItems, searchQuery]);

	const lightboxIndex = useMemo(() => {
		if (!lightboxId) {
			return -1;
		}
		return filteredItems.findIndex((entry) => entry.id === lightboxId);
	}, [filteredItems, lightboxId]);

	useEffect(() => {
		if (lightboxId && lightboxIndex === -1) {
			setLightboxId(null);
		}
	}, [lightboxId, lightboxIndex]);

	const handleOpenLightbox = useCallback((id: string) => {
		setLightboxId(id);
	}, []);

	const handleCloseLightbox = useCallback(() => {
		setLightboxId(null);
	}, []);

	const handleNavigateLightbox = useCallback(
		(nextIndex: number) => {
			const next = filteredItems[nextIndex];
			if (next) {
				setLightboxId(next.id);
			}
		},
		[filteredItems]
	);

	const handleDelete = useCallback(async (item: FeedItem) => {
		if (item.kind !== "studio") {
			toast.message(
				"Удалять элементы Cast/Datasets можно из соответствующего раздела."
			);
			return;
		}
		const shotId = item.id.replace(studioShotIdPrefix, "");
		setDeletingId(item.id);
		try {
			await deleteStudioShot(shotId);
			setStudioShots((current) => current.filter((shot) => shot.id !== shotId));
			toast.success("Shot удалён");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Не удалось удалить shot"
			);
		} finally {
			setDeletingId(null);
		}
	}, []);

	const handleDeleteSync = useCallback(
		(item: FeedItem) => {
			handleDelete(item).catch(() => undefined);
		},
		[handleDelete]
	);

	const canDeleteLightbox = useCallback(
		(item: LightboxItem) => item.id.startsWith("shot-"),
		[]
	);

	return (
		<WorkspaceShell
			actions={
				<>
					<ModeToggle />
					<UserMenu email={sessionEmail} name={sessionName} />
				</>
			}
			navigation={createWorkspaceNavigation("shots", {
				admin: adminUrl,
				persons: personsUrl,
				shots: "/shots",
				studio: "/",
			})}
			status={
				<>
					<WorkspaceStatus tone="info">{counts.studio} studio</WorkspaceStatus>
					<WorkspaceStatus tone="success">{counts.person} cast</WorkspaceStatus>
					<WorkspaceStatus tone="neutral">
						{counts.dataset} datasets
					</WorkspaceStatus>
				</>
			}
			subtitle="Все сохранённые кадры из студии, персонажей и LoRA-датасетов в одном месте."
			title="Shots"
			workspaceLabel="Studio"
		>
			<div className="flex h-full min-h-0 flex-col gap-3">
				<ShotsToolbar
					activeTab={activeTab}
					counts={counts}
					onSearchChange={setSearchQuery}
					onTabChange={setActiveTab}
					searchQuery={searchQuery}
				/>

				{warnings.length > 0 ? (
					<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-700 text-xs dark:text-amber-300">
						{warnings.join(" · ")}
					</div>
				) : null}

				<div
					className="min-h-0 flex-1 overflow-y-auto pr-1"
					id="shots-feed"
					role="tabpanel"
				>
					{filteredItems.length === 0 ? (
						<ShotsEmptyStateBlock
							activeTab={activeTab}
							hasSearch={searchQuery.trim().length > 0}
						/>
					) : (
						<div
							className="grid gap-3"
							style={
								{
									gridTemplateColumns:
										"repeat(auto-fill, minmax(min(160px, 100%), 1fr))",
								} as CSSProperties
							}
						>
							{filteredItems.map((item) => (
								<FeedTile
									deletingId={deletingId}
									item={item}
									key={item.id}
									onDelete={handleDeleteSync}
									onOpen={handleOpenLightbox}
								/>
							))}
						</div>
					)}
				</div>
			</div>

			{lightboxIndex >= 0 ? (
				<ShotsLightbox
					canDelete={canDeleteLightbox}
					deletingId={deletingId}
					index={lightboxIndex}
					items={filteredItems}
					onClose={handleCloseLightbox}
					onDelete={(item) => {
						const original = filteredItems.find(
							(entry) => entry.id === item.id
						);
						if (original) {
							handleDeleteSync(original);
						}
					}}
					onNavigate={handleNavigateLightbox}
				/>
			) : null}
		</WorkspaceShell>
	);
}
