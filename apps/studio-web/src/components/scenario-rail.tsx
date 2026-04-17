"use client";

import { Input } from "@generator/ui/components/input";
import { SectionLabel } from "@generator/ui/components/section-label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import { Activity, Clock3, FilterX, Layers, Plus, Search } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import IconButton from "./icon-button";

export type ScenarioRailStatus =
	| "draft"
	| "failed"
	| "queued"
	| "ready"
	| "running";

export interface ScenarioCardData {
	duration: string;
	id: string;
	name: string;
	prompt: string;
	runCount: number;
	status: ScenarioRailStatus;
	thumbnailUrl: string | null;
	updatedAt: string | null;
	workflowKey: string;
}

const scenarioStatusDot: Record<ScenarioRailStatus, string> = {
	draft: "bg-muted-foreground/40",
	failed: "bg-rose-500",
	queued: "bg-sky-500",
	ready: "bg-emerald-500",
	running: "bg-amber-500 animate-pulse",
};

const scenarioStatusLabel: Record<ScenarioRailStatus, string> = {
	draft: "Draft",
	failed: "Failed",
	queued: "Queued",
	ready: "Ready",
	running: "Running",
};

type FilterId = "all" | "active" | "ready" | "failed" | "draft";

const filterOptions: { id: FilterId; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "active", label: "Active" },
	{ id: "ready", label: "Ready" },
	{ id: "failed", label: "Failed" },
	{ id: "draft", label: "Drafts" },
];

function matchesFilter(status: ScenarioRailStatus, filter: FilterId) {
	if (filter === "all") {
		return true;
	}

	if (filter === "active") {
		return status === "queued" || status === "running";
	}

	return status === filter;
}

export default function ScenarioRail({
	getHref,
	onCreateScenario,
	scenarios,
	selectedScenarioId,
}: {
	getHref: (scenarioId: string) => Route;
	onCreateScenario?: () => void;
	scenarios: ScenarioCardData[];
	selectedScenarioId: string | null;
}) {
	const [filter, setFilter] = useState<FilterId>("all");
	const [query, setQuery] = useState("");
	const searchId = useId();
	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		function handleKeydown(event: KeyboardEvent) {
			if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}

			const target = event.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				target?.isContentEditable === true;

			if (isEditableTarget) {
				return;
			}

			event.preventDefault();
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		}

		window.addEventListener("keydown", handleKeydown);
		return () => {
			window.removeEventListener("keydown", handleKeydown);
		};
	}, []);

	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();

		return scenarios.filter((scenario) => {
			if (!matchesFilter(scenario.status, filter)) {
				return false;
			}

			if (!normalized) {
				return true;
			}

			return (
				scenario.name.toLowerCase().includes(normalized) ||
				scenario.workflowKey.toLowerCase().includes(normalized) ||
				scenario.prompt.toLowerCase().includes(normalized)
			);
		});
	}, [filter, query, scenarios]);

	const activeCount = scenarios.filter(
		(scenario) => scenario.status === "queued" || scenario.status === "running"
	).length;

	return (
		<div className="studio-surface flex min-h-0 flex-col">
			<header className="flex items-center justify-between gap-2 px-3 py-2.5">
				<div className="flex items-center gap-2">
					<SectionLabel>Scenarios</SectionLabel>
					<span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
						{scenarios.length}
					</span>
					{activeCount > 0 ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
							<Activity className="size-2.5" />
							{activeCount}
						</span>
					) : null}
				</div>

				{onCreateScenario ? (
					<IconButton
						hint="Compose new scenario"
						label="New scenario"
						onClick={onCreateScenario}
					>
						<Plus className="size-3.5" />
					</IconButton>
				) : null}
			</header>

			<div className="grid gap-2 px-3 pb-2">
				<div className="relative">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Search scenarios"
						className="h-7 pr-12 pl-7 text-[11px]"
						id={searchId}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search by name, workflow, prompt"
						ref={searchInputRef}
						value={query}
					/>
					{query ? null : (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-foreground/10 bg-foreground/[0.04] px-1 font-mono text-[9px] text-muted-foreground"
						>
							/
						</span>
					)}
					{query ? (
						<button
							aria-label="Clear search"
							className="absolute top-1/2 right-1.5 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground/70 transition hover:bg-muted/40 hover:text-foreground"
							onClick={() => setQuery("")}
							type="button"
						>
							<FilterX className="size-3" />
						</button>
					) : null}
				</div>

				<div
					aria-label="Filter scenarios"
					className="flex flex-wrap gap-1"
					role="tablist"
				>
					{filterOptions.map((option) => {
						const isActive = filter === option.id;

						return (
							<button
								aria-selected={isActive}
								className={cn(
									"rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide transition",
									isActive
										? "bg-foreground text-background"
										: "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
								)}
								key={option.id}
								onClick={() => setFilter(option.id)}
								role="tab"
								type="button"
							>
								{option.label}
							</button>
						);
					})}
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{filtered.length === 0 ? (
					<div className="grid gap-2 px-3 py-6 text-center">
						<Layers
							aria-hidden="true"
							className="mx-auto size-5 text-muted-foreground/50"
							strokeWidth={1.5}
						/>
						<p className="text-muted-foreground text-xs">
							{scenarios.length === 0
								? "No scenarios yet."
								: "No matches found."}
						</p>
						<p className="text-[11px] text-muted-foreground/60">
							{scenarios.length === 0
								? "Compose one from the dock on the right."
								: "Try a different filter or query."}
						</p>
					</div>
				) : (
					<ul className="grid gap-0.5">
						{filtered.map((scenario) => (
							<ScenarioRailItem
								getHref={getHref}
								isActive={scenario.id === selectedScenarioId}
								key={scenario.id}
								scenario={scenario}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function ScenarioRailItem({
	getHref,
	isActive,
	scenario,
}: {
	getHref: (scenarioId: string) => Route;
	isActive: boolean;
	scenario: ScenarioCardData;
}) {
	const promptPreview = scenario.prompt || scenario.workflowKey;

	return (
		<li>
			<Link
				aria-current={isActive ? "true" : undefined}
				className={cn(
					"flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
					isActive
						? "bg-foreground text-background"
						: "hover:bg-muted/20 dark:hover:bg-muted/10"
				)}
				href={getHref(scenario.id)}
				scroll={false}
			>
				<div className="relative size-9 shrink-0 overflow-hidden rounded-md bg-muted/20 dark:bg-muted/10">
					{scenario.thumbnailUrl ? (
						<div
							aria-hidden="true"
							className="absolute inset-0 bg-center bg-cover"
							style={{
								backgroundImage: `url("${scenario.thumbnailUrl}")`,
							}}
						/>
					) : (
						<Layers
							aria-hidden="true"
							className={cn(
								"absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2",
								isActive ? "text-background/40" : "text-muted-foreground/40"
							)}
							strokeWidth={1.5}
						/>
					)}
					<span
						className={cn(
							"absolute right-0.5 bottom-0.5 size-2 rounded-full ring-1 ring-background",
							scenarioStatusDot[scenario.status]
						)}
					>
						<span className="sr-only">
							{scenarioStatusLabel[scenario.status]}
						</span>
					</span>
				</div>

				<div className="min-w-0 flex-1">
					<p
						className={cn(
							"truncate font-medium text-xs leading-tight",
							isActive ? "text-background" : "text-foreground"
						)}
					>
						{scenario.name}
					</p>
					<Tooltip>
						<TooltipTrigger
							render={
								<p
									className={cn(
										"mt-0.5 line-clamp-1 text-[11px] leading-tight",
										isActive ? "text-background/65" : "text-muted-foreground"
									)}
								/>
							}
						>
							{promptPreview}
						</TooltipTrigger>
						<TooltipContent className="max-w-sm items-start text-left leading-relaxed">
							{promptPreview}
						</TooltipContent>
					</Tooltip>
					<div
						className={cn(
							"mt-1 flex items-center gap-2 text-[10px]",
							isActive ? "text-background/60" : "text-muted-foreground/80"
						)}
					>
						<span className="truncate">{scenario.workflowKey}</span>
						<span className="inline-flex items-center gap-0.5">
							<Clock3 className="size-2.5" />
							{scenario.duration}
						</span>
						<span className="inline-flex items-center gap-0.5">
							<Activity className="size-2.5" />
							{scenario.runCount}
						</span>
					</div>
				</div>
			</Link>
		</li>
	);
}
