"use client";

import type {
	LoraBaseModel,
	LoraRegistryEntry,
} from "@generator/contracts/loras";
import { LORA_BASE_MODELS } from "@generator/contracts/loras";
import { Button } from "@generator/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import { formatDateTime } from "@generator/ui/lib/format";
import { Archive, Loader2, Plus } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
	archiveLora,
	createLoraFromUrl,
	fetchAdminLoras,
} from "@/lib/loras-client";

const selectClassName =
	"flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

const baseModelLabels: Record<LoraBaseModel, string> = {
	"z-image": "Z-Image",
	flux: "Flux",
	sdxl: "SDXL",
	other: "Other",
};

function formatBytes(value: number) {
	if (!value) {
		return "—";
	}
	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(1)} KB`;
	}
	if (value < 1024 * 1024 * 1024) {
		return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function LorasConsole() {
	const [loras, setLoras] = useState<LoraRegistryEntry[]>([]);
	const [filterBaseModel, setFilterBaseModel] = useState<LoraBaseModel | "">(
		""
	);
	const [isLoading, setIsLoading] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const [name, setName] = useState("");
	const [sourceUrl, setSourceUrl] = useState("");
	const [baseModel, setBaseModel] = useState<LoraBaseModel>("z-image");
	const [defaultWeight, setDefaultWeight] = useState("1");
	const [description, setDescription] = useState("");

	const loadLoras = useCallback(async (filter: LoraBaseModel | "") => {
		setIsLoading(true);
		try {
			const items = await fetchAdminLoras(filter ? { baseModel: filter } : {});
			setLoras(items);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load LoRAs"
			);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		loadLoras(filterBaseModel).catch(() => {
			// handled in loadLoras
		});
	}, [filterBaseModel, loadLoras]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!(name && sourceUrl)) {
			toast.error("Name and source URL are required");
			return;
		}
		setIsSubmitting(true);
		try {
			const weight = Number(defaultWeight);
			const lora = await createLoraFromUrl({
				name: name.trim(),
				sourceUrl: sourceUrl.trim(),
				baseModel,
				defaultWeight: Number.isFinite(weight) ? weight : 1,
				description: description.trim() || undefined,
			});
			toast.success(`Added LoRA "${lora.name}"`);
			setName("");
			setSourceUrl("");
			setDescription("");
			setDefaultWeight("1");
			await loadLoras(filterBaseModel);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to add LoRA"
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleArchive = async (id: string) => {
		try {
			await archiveLora(id);
			toast.success("LoRA archived");
			await loadLoras(filterBaseModel);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to archive LoRA"
			);
		}
	};

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Add LoRA from URL</CardTitle>
					<CardDescription>
						Downloads a LoRA from the given URL (CivitAI/HuggingFace) and caches
						it in S3 under <code>loras/external/</code>.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
						<div className="grid gap-1.5">
							<Label htmlFor="lora-name">Name</Label>
							<Input
								id="lora-name"
								onChange={(e) => setName(e.target.value)}
								placeholder="ZIT Mystic XXX"
								value={name}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="lora-base-model">Base model</Label>
							<select
								className={selectClassName}
								id="lora-base-model"
								onChange={(e) => setBaseModel(e.target.value as LoraBaseModel)}
								value={baseModel}
							>
								{LORA_BASE_MODELS.map((model) => (
									<option key={model} value={model}>
										{baseModelLabels[model]}
									</option>
								))}
							</select>
						</div>
						<div className="grid gap-1.5 md:col-span-2">
							<Label htmlFor="lora-source-url">Source URL</Label>
							<Input
								id="lora-source-url"
								onChange={(e) => setSourceUrl(e.target.value)}
								placeholder="https://civitai.com/api/download/models/..."
								value={sourceUrl}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="lora-default-weight">Default weight</Label>
							<Input
								id="lora-default-weight"
								onChange={(e) => setDefaultWeight(e.target.value)}
								step="0.05"
								type="number"
								value={defaultWeight}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="lora-description">Description</Label>
							<Input
								id="lora-description"
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Optional"
								value={description}
							/>
						</div>
						<div className="md:col-span-2">
							<Button disabled={isSubmitting} type="submit">
								{isSubmitting ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Plus className="mr-2 h-4 w-4" />
								)}
								Add LoRA
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-3">
						<div>
							<CardTitle>Registry</CardTitle>
							<CardDescription>
								Shared across Studio and Persons.
							</CardDescription>
						</div>
						<div className="grid gap-1">
							<SectionLabel>Filter by base model</SectionLabel>
							<select
								className={selectClassName}
								onChange={(e) =>
									setFilterBaseModel(e.target.value as LoraBaseModel | "")
								}
								value={filterBaseModel}
							>
								<option value="">All</option>
								{LORA_BASE_MODELS.map((model) => (
									<option key={model} value={model}>
										{baseModelLabels[model]}
									</option>
								))}
							</select>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{renderLorasList({ handleArchive, isLoading, loras })}
				</CardContent>
			</Card>
		</div>
	);
}

function renderLorasList({
	handleArchive,
	isLoading,
	loras,
}: {
	handleArchive: (id: string) => void;
	isLoading: boolean;
	loras: LoraRegistryEntry[];
}) {
	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-8 text-muted-foreground">
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
		<div className="grid gap-2">
			{loras.map((lora) => (
				<div
					className="grid gap-2 rounded-lg border border-foreground/10 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
					key={lora.id}
				>
					<div className="grid gap-1">
						<div className="flex items-center gap-2">
							<p className="font-medium text-sm">{lora.name}</p>
							<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
								{baseModelLabels[lora.baseModel]}
							</span>
							{lora.status === "archived" ? (
								<span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 text-xs dark:text-amber-300">
									archived
								</span>
							) : null}
						</div>
						<p className="truncate text-muted-foreground text-xs">
							{lora.s3Url}
						</p>
						<p className="text-muted-foreground text-xs">
							slug: <code>{lora.slug}</code> · weight: {lora.defaultWeight} ·
							size: {formatBytes(lora.sizeBytes)} · added{" "}
							{formatDateTime(lora.createdAt)}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{lora.status === "active" ? (
							<Button
								onClick={() => handleArchive(lora.id)}
								size="sm"
								variant="outline"
							>
								<Archive className="mr-2 h-3.5 w-3.5" />
								Archive
							</Button>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}
