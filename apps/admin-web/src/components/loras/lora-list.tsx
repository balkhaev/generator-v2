"use client";

import { groupBaseModelsByFamily } from "@generator/contracts/base-models";
import type {
	LoraBaseModel,
	LoraRegistryEntry,
} from "@generator/contracts/loras";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Loader2 } from "lucide-react";

import LoraRow from "./lora-row";

const baseModelGroups = groupBaseModelsByFamily();

const selectClassName =
	"h-8 rounded-md border border-foreground/10 bg-background px-2 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

export default function LoraList({
	filterBaseModel,
	isLoading,
	loras,
	onFilterChange,
	onSelect,
	selectedId,
}: {
	filterBaseModel: LoraBaseModel | "";
	isLoading: boolean;
	loras: LoraRegistryEntry[];
	onFilterChange: (value: LoraBaseModel | "") => void;
	onSelect: (id: string) => void;
	selectedId: string | null;
}) {
	return (
		<div className="grid gap-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-xs">
					Shared registry across Studio and Persons.
				</p>
				<select
					aria-label="Filter by base model"
					className={selectClassName}
					onChange={(event) =>
						onFilterChange(event.target.value as LoraBaseModel | "")
					}
					value={filterBaseModel}
				>
					<option value="">All base models</option>
					{baseModelGroups.map((group) => (
						<optgroup key={group.family} label={group.label}>
							{group.models.map((model) => (
								<option key={model.id} value={model.id}>
									{model.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
			</div>

			{renderBody({ isLoading, loras, onSelect, selectedId })}
		</div>
	);
}

function renderBody({
	isLoading,
	loras,
	onSelect,
	selectedId,
}: {
	isLoading: boolean;
	loras: LoraRegistryEntry[];
	onSelect: (id: string) => void;
	selectedId: string | null;
}) {
	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
				<Loader2 className="mr-2 size-4 animate-spin" />
				Loading…
			</div>
		);
	}
	if (loras.length === 0) {
		return (
			<EmptyState
				hint="Add your first LoRA using the form above."
				message="No LoRAs yet"
			/>
		);
	}
	return (
		<div className="grid gap-1.5">
			{loras.map((lora) => (
				<LoraRow
					isSelected={lora.id === selectedId}
					key={lora.id}
					lora={lora}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}
