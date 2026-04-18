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
import WorkspaceShell, {
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import {
	ExternalLink,
	Image as ImageIcon,
	Loader2,
	Search,
	Trash2,
	Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

type FeedKind = "studio" | "person";
type FeedFilter = "all" | FeedKind;

const studioShotIdPrefix = /^shot-/;

interface FeedItem {
	artifactKind: "image" | "video";
	createdAt: string;
	id: string;
	kind: FeedKind;
	openHref: string;
	personName: string | null;
	scenarioName: string | null;
	subtitle: string;
	thumbnailUrl: string;
	title: string;
}

function buildPersonsItems(
	persons: PersonRecord[],
	personsBaseUrl: string
): FeedItem[] {
	return persons.flatMap((person) =>
		person.generations
			.filter(
				(generation) => generation.previewUrl ?? generation.sourceUrl ?? null
			)
			.map<FeedItem>((generation: PersonGenerationRecord) => {
				const url = generation.previewUrl ?? generation.sourceUrl ?? "";
				return {
					artifactKind: generation.mediaType === "video" ? "video" : "image",
					createdAt: generation.createdAt,
					id: `person-${generation.id}`,
					kind: "person",
					openHref: `${personsBaseUrl}/${person.slug}`,
					personName: person.name,
					scenarioName: generation.title,
					subtitle: generation.title,
					thumbnailUrl: url,
					title: person.name,
				};
			})
	);
}

function buildShotsItems(shots: ScenarioShotRecord[]): FeedItem[] {
	return shots.map<FeedItem>((shot) => ({
		artifactKind: shot.artifactKind === "video" ? "video" : "image",
		createdAt: shot.createdAt,
		id: `shot-${shot.id}`,
		kind: "studio",
		openHref: shot.artifactUrl,
		personName: null,
		scenarioName: shot.scenarioName,
		subtitle: shot.note ?? shot.scenarioName,
		thumbnailUrl: shot.artifactUrl,
		title: shot.scenarioName,
	}));
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
	const [filter, setFilter] = useState<FeedFilter>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [studioShots, setStudioShots] = useState(shots);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const items = useMemo(() => {
		const combined: FeedItem[] = [
			...buildShotsItems(studioShots),
			...buildPersonsItems(persons, personsUrl),
		];
		return combined.sort((left, right) =>
			right.createdAt.localeCompare(left.createdAt)
		);
	}, [persons, personsUrl, studioShots]);

	const filteredItems = useMemo(() => {
		const lowered = searchQuery.trim().toLowerCase();
		return items.filter((item) => {
			if (filter !== "all" && item.kind !== filter) {
				return false;
			}
			if (!lowered) {
				return true;
			}
			return (
				item.title.toLowerCase().includes(lowered) ||
				item.subtitle.toLowerCase().includes(lowered) ||
				(item.personName ?? "").toLowerCase().includes(lowered)
			);
		});
	}, [filter, items, searchQuery]);

	async function handleDelete(item: FeedItem) {
		if (item.kind !== "studio") {
			toast.message("Person generations can only be deleted from Cast.");
			return;
		}
		const shotId = item.id.replace(studioShotIdPrefix, "");
		setDeletingId(item.id);
		try {
			await deleteStudioShot(shotId);
			setStudioShots((current) => current.filter((shot) => shot.id !== shotId));
			toast.success("Shot removed.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to delete shot."
			);
		} finally {
			setDeletingId(null);
		}
	}

	const filterOptions: { id: FeedFilter; label: string }[] = [
		{ id: "all", label: "All" },
		{ id: "studio", label: "Studio shots" },
		{ id: "person", label: "Person generations" },
	];

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
					<WorkspaceStatus tone="info">
						{studioShots.length} studio
					</WorkspaceStatus>
					<WorkspaceStatus tone="success">
						{persons.reduce(
							(sum, person) => sum + person.generations.length,
							0
						)}{" "}
						person
					</WorkspaceStatus>
				</>
			}
			subtitle="All saved generations across studio scenarios and persons."
			title="Shots"
			workspaceLabel="Studio"
		>
			<div className="flex h-full min-h-0 flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/8 bg-background/80 px-3 py-2.5 backdrop-blur-xl dark:bg-background/60">
					<div className="flex flex-wrap items-center gap-1">
						{filterOptions.map((option) => {
							const isActive = filter === option.id;
							return (
								<button
									aria-pressed={isActive}
									className={cn(
										"inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] transition",
										isActive
											? "bg-foreground text-background"
											: "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
									)}
									key={option.id}
									onClick={() => setFilter(option.id)}
									type="button"
								>
									{option.label}
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
							onChange={(event) => setSearchQuery(event.target.value)}
							placeholder="Search by name, scenario, prompt…"
							value={searchQuery}
						/>
					</div>
				</div>

				{warnings.length > 0 ? (
					<div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-amber-700 text-xs dark:text-amber-300">
						{warnings.join(" · ")}
					</div>
				) : null}

				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					{filteredItems.length === 0 ? (
						<EmptyState
							hint="Save shots from the studio preview or import generations into persons to see them here."
							message="No saved shots yet."
						/>
					) : (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
							{filteredItems.map((item) => (
								<article
									className="group relative overflow-hidden rounded-xl border border-foreground/8 bg-muted/5"
									key={item.id}
								>
									{item.artifactKind === "video" ? (
										<video
											className="aspect-[9/16] w-full object-cover"
											muted
											playsInline
											preload="metadata"
											src={item.thumbnailUrl}
										/>
									) : (
										<div
											aria-hidden="true"
											className="aspect-[9/16] bg-center bg-cover"
											style={{
												backgroundImage: `url("${item.thumbnailUrl}")`,
											}}
										/>
									)}
									<div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] backdrop-blur-md">
										{item.artifactKind === "video" ? (
											<Video className="size-3" />
										) : (
											<ImageIcon className="size-3" />
										)}
										{item.kind === "studio" ? "Studio" : "Person"}
									</div>
									<div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pt-8 pb-2">
										<div className="min-w-0 text-white">
											<p className="truncate text-[11px]">{item.title}</p>
											<p className="truncate text-[10px] text-white/70">
												{item.subtitle} · {formatRelativeTime(item.createdAt)}
											</p>
										</div>
										<div className="flex items-center gap-1">
											<a
												aria-label="Open"
												className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/30"
												href={item.openHref}
												rel="noreferrer"
												target="_blank"
											>
												<ExternalLink className="size-3" />
											</a>
											{item.kind === "studio" ? (
												<button
													aria-label="Delete shot"
													className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-rose-500/60 disabled:opacity-50"
													disabled={deletingId === item.id}
													onClick={() => {
														handleDelete(item).catch(() => undefined);
													}}
													type="button"
												>
													{deletingId === item.id ? (
														<Loader2 className="size-3 animate-spin" />
													) : (
														<Trash2 className="size-3" />
													)}
												</button>
											) : null}
										</div>
									</div>
								</article>
							))}
						</div>
					)}
				</div>
			</div>
		</WorkspaceShell>
	);
}
