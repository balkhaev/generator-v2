"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@generator/ui/components/dialog";
import { cn } from "@generator/ui/lib/utils";
import {
	Bookmark,
	CornerDownLeft,
	Film,
	Image as ImageIcon,
	type LucideIcon,
	Moon,
	Plus,
	Search,
	ShieldEllipsis,
	Sun,
	UsersRound,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type {
	ScenarioCardData,
	ScenarioRailStatus,
} from "@/components/scenario-card-data";

export interface CommandPalettePerson {
	id: string;
	name: string;
	slug: string;
}

type CommandGroup = "Actions" | "Scenarios" | "Persons";

interface CommandEntry {
	current?: boolean;
	group: CommandGroup;
	icon: LucideIcon;
	id: string;
	keywords: string;
	label: string;
	meta?: string;
	onSelect: () => void;
	status?: ScenarioRailStatus;
}

const GROUP_ORDER: CommandGroup[] = ["Actions", "Scenarios", "Persons"];

const statusDotClassName: Record<ScenarioRailStatus, string> = {
	draft: "bg-muted-foreground/40",
	failed: "bg-rose-500",
	queued: "bg-amber-500",
	ready: "bg-emerald-500",
	running: "bg-amber-500 animate-pulse",
};

function normalize(value: string) {
	return value.toLowerCase().trim();
}

function matchesQuery(entry: CommandEntry, query: string) {
	if (!query) {
		return true;
	}
	const haystack = `${entry.label} ${entry.meta ?? ""} ${entry.keywords} ${entry.group}`;
	return normalize(haystack).includes(query);
}

export function StudioCommandPalette({
	adminUrl,
	onCreateScenario,
	onOpenChange,
	onPickPerson,
	onPickScenario,
	open,
	persons,
	personsUrl,
	scenarioCards,
	selectedPersonId,
	selectedScenarioId,
}: {
	adminUrl: string;
	onCreateScenario: () => void;
	onOpenChange: (open: boolean) => void;
	onPickPerson: (personId: string) => void;
	onPickScenario: (scenarioId: string) => void;
	open: boolean;
	persons: CommandPalettePerson[];
	personsUrl: string;
	scenarioCards: ScenarioCardData[];
	selectedPersonId: string | null;
	selectedScenarioId: string | null;
}) {
	const router = useRouter();
	const { resolvedTheme, setTheme } = useTheme();
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const close = useCallback(() => onOpenChange(false), [onOpenChange]);

	const run = useCallback(
		(action: () => void) => {
			close();
			action();
		},
		[close]
	);

	// Global ⌘K / Ctrl+K toggle. Mounted for the lifetime of the shell so the
	// shortcut works regardless of the palette being open or closed.
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				onOpenChange(!open);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onOpenChange, open]);

	const entries = useMemo<CommandEntry[]>(() => {
		const themeIsDark = resolvedTheme === "dark";
		const actions: CommandEntry[] = [
			{
				group: "Actions",
				icon: Plus,
				id: "action:new-scenario",
				keywords: "create compose new scenario workflow template add",
				label: "New scenario",
				onSelect: () => run(onCreateScenario),
			},
			{
				group: "Actions",
				icon: Bookmark,
				id: "action:open-shots",
				keywords: "shots gallery saved bookmarks library",
				label: "Open Shots gallery",
				onSelect: () => run(() => router.push("/shots" as Route)),
			},
			{
				group: "Actions",
				icon: UsersRound,
				id: "action:open-persons",
				keywords: "persons cast workspace lora characters",
				label: "Open Persons workspace",
				meta: "external",
				onSelect: () =>
					run(() => {
						window.location.href = personsUrl;
					}),
			},
			{
				group: "Actions",
				icon: ShieldEllipsis,
				id: "action:open-admin",
				keywords: "admin console settings ops monitoring",
				label: "Open Admin console",
				meta: "external",
				onSelect: () =>
					run(() => {
						window.location.href = adminUrl;
					}),
			},
			{
				group: "Actions",
				icon: themeIsDark ? Sun : Moon,
				id: "action:toggle-theme",
				keywords: "theme dark light mode appearance toggle",
				label: themeIsDark ? "Switch to light theme" : "Switch to dark theme",
				onSelect: () => run(() => setTheme(themeIsDark ? "light" : "dark")),
			},
		];

		const scenarios: CommandEntry[] = scenarioCards.map((scenario) => ({
			current: scenario.id === selectedScenarioId,
			group: "Scenarios",
			icon: scenario.generationKind === "video" ? Film : ImageIcon,
			id: `scenario:${scenario.id}`,
			keywords: `${scenario.workflowKey} ${scenario.prompt}`,
			label: scenario.name,
			meta: `${scenario.workflowKey} · ${scenario.runCount} runs`,
			onSelect: () => run(() => onPickScenario(scenario.id)),
			status: scenario.status,
		}));

		const personEntries: CommandEntry[] = persons.map((person) => ({
			current: person.id === selectedPersonId,
			group: "Persons",
			icon: UsersRound,
			id: `person:${person.id}`,
			keywords: person.slug,
			label: person.name,
			meta: person.slug,
			onSelect: () => run(() => onPickPerson(person.id)),
		}));

		return [...actions, ...scenarios, ...personEntries];
	}, [
		adminUrl,
		onCreateScenario,
		onPickPerson,
		onPickScenario,
		persons,
		personsUrl,
		resolvedTheme,
		router,
		run,
		scenarioCards,
		selectedPersonId,
		selectedScenarioId,
		setTheme,
	]);

	const filtered = useMemo(() => {
		const q = normalize(query);
		return entries.filter((entry) => matchesQuery(entry, q));
	}, [entries, query]);

	// Reset query and highlight whenever the palette is (re)opened.
	useEffect(() => {
		if (open) {
			setQuery("");
			setActiveIndex(0);
		}
	}, [open]);

	useEffect(() => {
		const node = itemRefs.current[activeIndex];
		node?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (filtered.length === 0) {
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((index) => (index + 1) % filtered.length);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex(
				(index) => (index - 1 + filtered.length) % filtered.length
			);
		} else if (event.key === "Enter") {
			event.preventDefault();
			filtered[activeIndex]?.onSelect();
		}
	};

	let flatIndex = -1;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
				hideCloseButton
				initialFocus={inputRef}
			>
				<DialogTitle className="sr-only">Command palette</DialogTitle>
				<DialogDescription className="sr-only">
					Search scenarios, persons and actions. Use arrow keys to navigate and
					Enter to select.
				</DialogDescription>

				<div className="flex items-center gap-2.5 border-foreground/8 border-b px-3.5 py-3 dark:border-foreground/12">
					<Search className="size-4 shrink-0 text-muted-foreground/70" />
					<input
						aria-label="Search scenarios, persons and actions"
						className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(0);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search scenarios, persons, actions…"
						ref={inputRef}
						value={query}
					/>
					<kbd className="hidden shrink-0 rounded-sm border border-foreground/10 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
						ESC
					</kbd>
				</div>

				<div className="max-h-[52vh] min-h-0 overflow-y-auto py-1.5">
					{filtered.length === 0 ? (
						<div className="px-4 py-10 text-center text-muted-foreground text-sm">
							No matches for “{query}”.
						</div>
					) : (
						GROUP_ORDER.map((group) => {
							const groupEntries = filtered.filter(
								(entry) => entry.group === group
							);
							if (groupEntries.length === 0) {
								return null;
							}
							return (
								<div className="mb-1 last:mb-0" key={group}>
									<div className="px-3.5 pt-2 pb-1 font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.18em]">
										{group}
									</div>
									{groupEntries.map((entry) => {
										flatIndex += 1;
										const index = flatIndex;
										const isActive = index === activeIndex;
										const Icon = entry.icon;
										return (
											<CommandRow
												icon={Icon}
												isActive={isActive}
												key={entry.id}
												label={entry.label}
												meta={entry.meta}
												onMouseEnter={() => setActiveIndex(index)}
												onSelect={entry.onSelect}
												ref={(node) => {
													itemRefs.current[index] = node;
												}}
												statusDot={
													entry.status ? (
														<span
															className={cn(
																"size-1.5 shrink-0 rounded-full",
																statusDotClassName[entry.status]
															)}
														/>
													) : null
												}
												suffix={
													entry.current ? (
														<span className="rounded-sm bg-foreground/8 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
															current
														</span>
													) : null
												}
											/>
										);
									})}
								</div>
							);
						})
					)}
				</div>

				<div className="flex items-center justify-between gap-3 border-foreground/8 border-t px-3.5 py-2 text-[10px] text-muted-foreground/70 dark:border-foreground/12">
					<span className="flex items-center gap-3">
						<span className="inline-flex items-center gap-1">
							<kbd className="rounded-sm border border-foreground/10 bg-muted/40 px-1 font-mono">
								↑
							</kbd>
							<kbd className="rounded-sm border border-foreground/10 bg-muted/40 px-1 font-mono">
								↓
							</kbd>
							navigate
						</span>
						<span className="inline-flex items-center gap-1">
							<CornerDownLeft className="size-3" />
							select
						</span>
					</span>
					<span className="inline-flex items-center gap-1">
						<kbd className="rounded-sm border border-foreground/10 bg-muted/40 px-1 font-mono">
							⌘K
						</kbd>
						toggle
					</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function CommandRow({
	icon: Icon,
	isActive,
	label,
	meta,
	onMouseEnter,
	onSelect,
	ref,
	statusDot,
	suffix,
}: {
	icon: LucideIcon;
	isActive: boolean;
	label: string;
	meta?: string;
	onMouseEnter: () => void;
	onSelect: () => void;
	ref: (node: HTMLButtonElement | null) => void;
	statusDot: ReactNode;
	suffix: ReactNode;
}) {
	return (
		<button
			className={cn(
				"flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm outline-none transition-colors",
				isActive ? "bg-accent text-accent-foreground" : "text-foreground"
			)}
			data-active={isActive}
			onClick={onSelect}
			onMouseEnter={onMouseEnter}
			ref={ref}
			type="button"
		>
			<Icon className="size-4 shrink-0 text-muted-foreground/80" />
			{statusDot}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{meta ? (
				<span className="shrink-0 truncate text-[11px] text-muted-foreground/70">
					{meta}
				</span>
			) : null}
			{suffix}
		</button>
	);
}
