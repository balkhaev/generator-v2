"use client";

import type { PersonRecord } from "@generator/contracts/persons";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@generator/ui/components/popover";
import { cn } from "@generator/ui/lib/utils";
import {
	Activity,
	ChevronDown,
	Clock3,
	Layers,
	Pencil,
	Plus,
	Search,
	Trash2,
	UserRound,
	UsersRound,
} from "lucide-react";
import type { Route } from "next";
import { useMemo, useState } from "react";

import IconButton from "@/components/icon-button";
import type { ScenarioCardData } from "@/components/scenario-card-data";

const scenarioStatusDot = {
	draft: "bg-muted-foreground/40",
	failed: "bg-rose-500",
	queued: "bg-sky-500",
	ready: "bg-emerald-500",
	running: "bg-amber-500 animate-pulse",
} as const;

type SubjectMode = "scenario" | "person";

export interface SubjectSwitcherProps {
	getPersonHref: (personId: string) => Route;
	getScenarioHref: (scenarioId: string) => Route;
	onCreateScenario?: () => void;
	onDeleteScenario?: (scenarioId: string) => void;
	onEditScenario?: (scenarioId: string) => void;
	onPickPerson: (personId: string) => void;
	onPickScenario: (scenarioId: string) => void;
	persons: PersonRecord[];
	scenarios: ScenarioCardData[];
	selectedPerson: PersonRecord | null;
	selectedPersonId: string | null;
	selectedScenarioId: string | null;
}

function ScenarioListItem({
	getScenarioHref,
	isActive,
	onDelete,
	onEdit,
	onPick,
	scenario,
}: {
	getScenarioHref: (scenarioId: string) => Route;
	isActive: boolean;
	onDelete?: (scenarioId: string) => void;
	onEdit?: (scenarioId: string) => void;
	onPick: (scenarioId: string) => void;
	scenario: ScenarioCardData;
}) {
	return (
		<li className="group/scenario relative">
			<a
				aria-current={isActive ? "true" : undefined}
				className={cn(
					"flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition",
					isActive
						? "bg-foreground text-background"
						: "hover:bg-muted/20 dark:hover:bg-muted/10"
				)}
				href={getScenarioHref(scenario.id)}
				onClick={() => onPick(scenario.id)}
			>
				<span
					aria-hidden="true"
					className={cn(
						"mt-1 size-2 shrink-0 rounded-full",
						scenarioStatusDot[scenario.status]
					)}
				/>
				<div className="min-w-0 flex-1">
					<p
						className={cn(
							"truncate font-medium text-xs leading-tight",
							isActive ? "text-background" : "text-foreground"
						)}
					>
						{scenario.name}
					</p>
					<p
						className={cn(
							"mt-0.5 line-clamp-1 text-[10px] leading-tight",
							isActive ? "text-background/65" : "text-muted-foreground"
						)}
					>
						{scenario.prompt || scenario.workflowKey}
					</p>
					<div
						className={cn(
							"mt-0.5 flex items-center gap-2 text-[10px]",
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
			</a>
			{onEdit || onDelete ? (
				<div className="absolute top-1 right-1 hidden items-center gap-0.5 group-focus-within/scenario:flex group-hover/scenario:flex">
					{onEdit ? (
						<button
							aria-label={`Edit ${scenario.name}`}
							className={cn(
								"inline-flex size-6 items-center justify-center rounded-md transition",
								isActive
									? "text-background/80 hover:bg-background/10"
									: "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
							)}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onEdit(scenario.id);
							}}
							title="Edit scenario"
							type="button"
						>
							<Pencil className="size-3" />
						</button>
					) : null}
					{onDelete ? (
						<button
							aria-label={`Delete ${scenario.name}`}
							className={cn(
								"inline-flex size-6 items-center justify-center rounded-md transition",
								isActive
									? "text-background/80 hover:bg-rose-500/20"
									: "text-muted-foreground hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400"
							)}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onDelete(scenario.id);
							}}
							title="Delete scenario"
							type="button"
						>
							<Trash2 className="size-3" />
						</button>
					) : null}
				</div>
			) : null}
		</li>
	);
}

function PersonListItem({
	getPersonHref,
	isActive,
	onPick,
	person,
}: {
	getPersonHref: (personId: string) => Route;
	isActive: boolean;
	onPick: (personId: string) => void;
	person: PersonRecord;
}) {
	const thumb = person.photoUrl ?? person.referencePhotoUrl ?? null;

	return (
		<li>
			<a
				aria-current={isActive ? "true" : undefined}
				className={cn(
					"flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
					isActive
						? "bg-foreground text-background"
						: "hover:bg-muted/20 dark:hover:bg-muted/10"
				)}
				href={getPersonHref(person.id)}
				onClick={() => onPick(person.id)}
			>
				<span className="relative size-8 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10">
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
					<p
						className={cn(
							"truncate font-medium text-xs leading-tight",
							isActive ? "text-background" : "text-foreground"
						)}
					>
						{person.name}
					</p>
					<p
						className={cn(
							"mt-0.5 truncate text-[10px] leading-tight",
							isActive ? "text-background/65" : "text-muted-foreground"
						)}
					>
						{person.slug} · LoRA ready
					</p>
				</div>
			</a>
		</li>
	);
}

function SwitcherTrigger({
	open,
	scenarioCount,
	selectedPerson,
	selectedScenario,
}: {
	open: boolean;
	scenarioCount: number;
	selectedPerson: PersonRecord | null;
	selectedScenario: ScenarioCardData | null;
}) {
	if (selectedPerson) {
		const thumb =
			selectedPerson.photoUrl ?? selectedPerson.referencePhotoUrl ?? null;
		return (
			<button
				className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/15"
				type="button"
			>
				<span className="relative size-6 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/20">
					{thumb ? (
						<span
							aria-hidden="true"
							className="absolute inset-0 bg-center bg-cover"
							style={{ backgroundImage: `url("${thumb}")` }}
						/>
					) : (
						<UserRound className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
					)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-xs leading-tight">
						{selectedPerson.name}
					</p>
					<p className="truncate text-[10px] text-muted-foreground">
						Person · LoRA generation
					</p>
				</div>
				<ChevronDown
					aria-hidden="true"
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180"
					)}
				/>
			</button>
		);
	}

	return (
		<button
			className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/15"
			type="button"
		>
			{selectedScenario ? (
				<span
					aria-hidden="true"
					className={cn(
						"size-2 shrink-0 rounded-full",
						scenarioStatusDot[selectedScenario.status]
					)}
				/>
			) : (
				<Layers
					aria-hidden="true"
					className="size-3.5 shrink-0 text-muted-foreground/60"
				/>
			)}
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-xs leading-tight">
					{selectedScenario?.name ?? "Pick scenario or person"}
				</p>
				<p className="truncate text-[10px] text-muted-foreground">
					{selectedScenario
						? `${selectedScenario.workflowKey} · ${selectedScenario.duration} · ${selectedScenario.runCount} runs`
						: `${scenarioCount} scenarios`}
				</p>
			</div>
			<ChevronDown
				aria-hidden="true"
				className={cn(
					"size-3.5 shrink-0 text-muted-foreground transition-transform",
					open && "rotate-180"
				)}
			/>
		</button>
	);
}

export default function SubjectSwitcher({
	getPersonHref,
	getScenarioHref,
	onCreateScenario,
	onDeleteScenario,
	onEditScenario,
	onPickPerson,
	onPickScenario,
	persons,
	scenarios,
	selectedPerson,
	selectedPersonId,
	selectedScenarioId,
}: SubjectSwitcherProps) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<SubjectMode>(
		selectedPerson ? "person" : "scenario"
	);
	const [query, setQuery] = useState("");

	const trainablePersons = useMemo(
		() => persons.filter((person) => Boolean(person.loraUrl)),
		[persons]
	);

	const filteredScenarios = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return scenarios;
		}
		return scenarios.filter(
			(scenario) =>
				scenario.name.toLowerCase().includes(normalized) ||
				scenario.workflowKey.toLowerCase().includes(normalized) ||
				scenario.prompt.toLowerCase().includes(normalized)
		);
	}, [query, scenarios]);

	const filteredPersons = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return trainablePersons;
		}
		return trainablePersons.filter(
			(person) =>
				person.name.toLowerCase().includes(normalized) ||
				person.slug.toLowerCase().includes(normalized)
		);
	}, [query, trainablePersons]);

	const selectedScenario =
		scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;

	function handleOpenChange(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen) {
			setTab(selectedPerson ? "person" : "scenario");
			setQuery("");
		}
	}

	return (
		<div className="flex min-w-0 items-center gap-1">
			<Popover onOpenChange={handleOpenChange} open={open}>
				<PopoverTrigger
					render={
						<SwitcherTrigger
							open={open}
							scenarioCount={scenarios.length}
							selectedPerson={selectedPerson}
							selectedScenario={selectedScenario}
						/>
					}
				/>
				<PopoverContent className="flex max-h-[60vh] w-(--anchor-width) min-w-72 flex-col gap-2 p-2">
					<div className="flex items-center gap-1 rounded-lg bg-muted/15 p-0.5">
						<button
							aria-pressed={tab === "scenario"}
							className={cn(
								"inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] transition",
								tab === "scenario"
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground"
							)}
							onClick={() => setTab("scenario")}
							type="button"
						>
							<Layers className="size-3" />
							Scenarios
							<span className="tabular-nums opacity-70">
								{scenarios.length}
							</span>
						</button>
						<button
							aria-pressed={tab === "person"}
							className={cn(
								"inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] transition",
								tab === "person"
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground"
							)}
							onClick={() => setTab("person")}
							type="button"
						>
							<UsersRound className="size-3" />
							Persons
							<span className="tabular-nums opacity-70">
								{trainablePersons.length}
							</span>
						</button>
					</div>

					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							aria-label={
								tab === "scenario" ? "Search scenarios" : "Search persons"
							}
							className="h-8 pl-7 text-xs"
							onChange={(event) => setQuery(event.target.value)}
							placeholder={
								tab === "scenario"
									? "Search by name, workflow, prompt"
									: "Search by name or slug"
							}
							value={query}
						/>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto">
						{tab === "scenario" ? (
							<ScenarioList
								filteredScenarios={filteredScenarios}
								getScenarioHref={getScenarioHref}
								onDeleteScenario={
									onDeleteScenario
										? (id) => {
												setOpen(false);
												onDeleteScenario(id);
											}
										: undefined
								}
								onEditScenario={
									onEditScenario
										? (id) => {
												setOpen(false);
												onEditScenario(id);
											}
										: undefined
								}
								onPick={(id) => {
									onPickScenario(id);
									setOpen(false);
								}}
								scenarios={scenarios}
								selectedScenarioId={selectedScenarioId}
							/>
						) : (
							<PersonList
								filteredPersons={filteredPersons}
								getPersonHref={getPersonHref}
								onPick={(id) => {
									onPickPerson(id);
									setOpen(false);
								}}
								selectedPersonId={selectedPersonId}
								trainablePersons={trainablePersons}
							/>
						)}
					</div>

					{tab === "scenario" && onCreateScenario ? (
						<Button
							onClick={() => {
								setOpen(false);
								onCreateScenario();
							}}
							size="sm"
							variant="outline"
						>
							<Plus className="size-3.5" />
							New scenario
						</Button>
					) : null}
				</PopoverContent>
			</Popover>
			{onCreateScenario ? (
				<IconButton
					hint="Compose new scenario"
					label="New scenario"
					onClick={onCreateScenario}
				>
					<Plus className="size-3.5" />
				</IconButton>
			) : null}
		</div>
	);
}

function ScenarioList({
	filteredScenarios,
	getScenarioHref,
	onDeleteScenario,
	onEditScenario,
	onPick,
	scenarios,
	selectedScenarioId,
}: {
	filteredScenarios: ScenarioCardData[];
	getScenarioHref: (scenarioId: string) => Route;
	onDeleteScenario?: (scenarioId: string) => void;
	onEditScenario?: (scenarioId: string) => void;
	onPick: (scenarioId: string) => void;
	scenarios: ScenarioCardData[];
	selectedScenarioId: string | null;
}) {
	if (filteredScenarios.length === 0) {
		return (
			<p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
				{scenarios.length === 0 ? "No scenarios yet." : "No matches found."}
			</p>
		);
	}
	return (
		<ul className="grid gap-0.5">
			{filteredScenarios.map((scenario) => (
				<ScenarioListItem
					getScenarioHref={getScenarioHref}
					isActive={scenario.id === selectedScenarioId}
					key={scenario.id}
					onDelete={onDeleteScenario}
					onEdit={onEditScenario}
					onPick={onPick}
					scenario={scenario}
				/>
			))}
		</ul>
	);
}

function PersonList({
	filteredPersons,
	getPersonHref,
	onPick,
	selectedPersonId,
	trainablePersons,
}: {
	filteredPersons: PersonRecord[];
	getPersonHref: (personId: string) => Route;
	onPick: (personId: string) => void;
	selectedPersonId: string | null;
	trainablePersons: PersonRecord[];
}) {
	if (filteredPersons.length === 0) {
		return (
			<p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
				{trainablePersons.length === 0
					? "No trained Cast LoRAs yet."
					: "No matches found."}
			</p>
		);
	}
	return (
		<ul className="grid gap-0.5">
			{filteredPersons.map((person) => (
				<PersonListItem
					getPersonHref={getPersonHref}
					isActive={person.id === selectedPersonId}
					key={person.id}
					onPick={onPick}
					person={person}
				/>
			))}
		</ul>
	);
}
