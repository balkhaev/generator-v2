"use client";

import { groupBaseModelsByFamily } from "@generator/contracts/base-models";
import type {
	LoraBaseModel,
	LoraRegistryEntry,
} from "@generator/contracts/loras";
import { EmptyState } from "@generator/ui/components/empty-state";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectGroupLabel,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@generator/ui/components/select";
import { Loader2 } from "lucide-react";

import LoraRow from "./lora-row";

const baseModelGroups = groupBaseModelsByFamily();

const ALL_BASE_MODELS_OPTION = { label: "All base models", value: "" };
const baseModelFilterItems = [
	ALL_BASE_MODELS_OPTION,
	...baseModelGroups.flatMap((group) =>
		group.models.map((model) => ({ label: model.label, value: model.id }))
	),
];

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
				<Select
					items={baseModelFilterItems}
					onValueChange={(value) =>
						onFilterChange((value ?? "") as LoraBaseModel | "")
					}
					value={filterBaseModel}
				>
					<SelectTrigger aria-label="Filter by base model" className="w-56">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">{ALL_BASE_MODELS_OPTION.label}</SelectItem>
						{baseModelGroups.map((group) => (
							<SelectGroup key={group.family}>
								<SelectGroupLabel>{group.label}</SelectGroupLabel>
								{group.models.map((model) => (
									<SelectItem key={model.id} value={model.id}>
										{model.label}
									</SelectItem>
								))}
							</SelectGroup>
						))}
					</SelectContent>
				</Select>
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
