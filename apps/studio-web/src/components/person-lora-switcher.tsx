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
import { ChevronDown, Search, UserRound, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

import { THUMB_GRID_CLASSES } from "@/components/persons-input-picker";

interface PersonLoraSwitcherProps {
	className?: string;
	disabled?: boolean;
	disabledHint?: string;
	onSelect: (personId: string | null) => void;
	persons: PersonRecord[];
	selectedPersonId: string | null;
}

function personLoraStatusLine(selected: PersonRecord | null): string {
	if (!selected) {
		return "Optional — pick a person";
	}
	if (selected.loraUrl) {
		return "LoRA will override scenario URL";
	}
	return "No LoRA trained";
}

export default function PersonLoraSwitcher({
	className,
	disabled = false,
	disabledHint,
	onSelect,
	persons,
	selectedPersonId,
}: PersonLoraSwitcherProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const selected = persons.find((p) => p.id === selectedPersonId) ?? null;

	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return persons;
		}
		return persons.filter(
			(p) =>
				p.name.toLowerCase().includes(normalized) ||
				p.slug.toLowerCase().includes(normalized)
		);
	}, [persons, query]);

	return (
		<div className={cn("flex min-w-0 flex-col gap-1", className)}>
			<p className="px-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
				Cast LoRA
			</p>
			<Popover onOpenChange={setOpen} open={disabled ? false : open}>
				<PopoverTrigger
					render={
						<button
							className={cn(
								"flex w-full min-w-0 items-center gap-2 rounded-lg border border-foreground/8 px-2 py-1.5 text-left transition",
								disabled
									? "cursor-not-allowed opacity-50"
									: "hover:bg-muted/15 dark:hover:bg-muted/8"
							)}
							disabled={disabled}
							type="button"
						>
							<div className="relative size-7 shrink-0 overflow-hidden rounded-md bg-muted/20 dark:bg-muted/10">
								{(selected?.photoUrl ?? selected?.referencePhotoUrl) ? (
									<div
										aria-hidden="true"
										className="absolute inset-0 bg-center bg-cover"
										style={{
											backgroundImage: `url("${selected.photoUrl ?? selected.referencePhotoUrl}")`,
										}}
									/>
								) : (
									<UserRound className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50" />
								)}
							</div>
							<div className="min-w-0 flex-1">
								<p className="truncate text-[11px] leading-tight">
									{selected?.name ?? "No Cast LoRA"}
								</p>
								<p className="truncate text-[10px] text-muted-foreground">
									{personLoraStatusLine(selected)}
								</p>
							</div>
							<ChevronDown
								aria-hidden="true"
								className={cn(
									"size-3 shrink-0 text-muted-foreground transition-transform",
									open && "rotate-180"
								)}
							/>
						</button>
					}
				/>
				<PopoverContent
					align="start"
					className="flex max-h-[min(420px,70vh)] w-(--anchor-width) min-w-64 flex-col gap-2 p-2"
				>
					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							aria-label="Search Cast persons"
							className="h-8 pl-7 text-xs"
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search by name or slug…"
							value={query}
						/>
					</div>
					<Button
						className="h-8 justify-start text-xs"
						onClick={() => {
							onSelect(null);
							setOpen(false);
						}}
						size="sm"
						variant="ghost"
					>
						<UsersRound className="size-3.5" />
						No Cast LoRA
					</Button>
					<div className="min-h-0 flex-1 overflow-y-auto">
						{filtered.length === 0 ? (
							<p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
								{persons.length === 0 ? "No persons in Cast." : "No matches."}
							</p>
						) : (
							<ul className={cn(THUMB_GRID_CLASSES, "py-0.5")}>
								{filtered.map((person) => {
									const thumb =
										person.photoUrl ?? person.referencePhotoUrl ?? null;
									const isActive = person.id === selectedPersonId;
									const hasLora = Boolean(person.loraUrl);
									return (
										<li key={person.id}>
											<button
												className={cn(
													"group relative aspect-square w-full overflow-hidden rounded-lg transition",
													isActive
														? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
														: "opacity-85 hover:opacity-100",
													!hasLora && "opacity-40"
												)}
												disabled={!hasLora}
												onClick={() => {
													if (!hasLora) {
														return;
													}
													onSelect(person.id);
													setOpen(false);
												}}
												type="button"
											>
												{thumb ? (
													<div
														aria-hidden="true"
														className="absolute inset-0 bg-center bg-cover"
														style={{ backgroundImage: `url("${thumb}")` }}
													/>
												) : (
													<div className="absolute inset-0 bg-muted/25" />
												)}
												<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-0.5 pt-4 pb-0.5">
													<p className="truncate text-center text-[9px] text-white leading-tight">
														{person.name}
													</p>
												</div>
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</PopoverContent>
			</Popover>
			{disabled && disabledHint ? (
				<p className="text-[10px] text-muted-foreground">{disabledHint}</p>
			) : null}
		</div>
	);
}
