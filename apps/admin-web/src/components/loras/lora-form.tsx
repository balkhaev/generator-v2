"use client";

import type { LoraBaseModel } from "@generator/contracts/loras";
import { LORA_BASE_MODELS } from "@generator/contracts/loras";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { Loader2, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { useCreateLora } from "@/hooks/use-admin-loras";

const baseModelLabels: Record<LoraBaseModel, string> = {
	"z-image": "Z-Image",
	flux: "Flux",
	sdxl: "SDXL",
	other: "Other",
};

const selectClassName =
	"flex h-9 w-full rounded-md border border-foreground/10 bg-transparent px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

export default function LoraForm() {
	const create = useCreateLora();
	const [name, setName] = useState("");
	const [sourceUrl, setSourceUrl] = useState("");
	const [baseModel, setBaseModel] = useState<LoraBaseModel>("z-image");
	const [defaultWeight, setDefaultWeight] = useState("1");
	const [description, setDescription] = useState("");

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!(name && sourceUrl)) {
			toast.error("Name and source URL are required");
			return;
		}
		try {
			const weight = Number(defaultWeight);
			const lora = await create.mutateAsync({
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
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to add LoRA"
			);
		}
	}

	return (
		<form
			className="grid gap-3 rounded-lg border border-foreground/8 bg-background/40 p-4 md:grid-cols-2 dark:bg-background/20"
			onSubmit={handleSubmit}
		>
			<div className="grid gap-1.5 md:col-span-2">
				<p className="font-medium text-sm">Add LoRA from URL</p>
				<p className="text-muted-foreground text-xs">
					Downloads the LoRA from CivitAI/HuggingFace and caches it in S3 under{" "}
					<code className="rounded bg-muted/20 px-1 py-0.5 text-[11px] dark:bg-muted/10">
						loras/external/
					</code>
					.
				</p>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="lora-name">Name</Label>
				<Input
					id="lora-name"
					onChange={(event) => setName(event.target.value)}
					placeholder="ZIT Mystic XXX"
					value={name}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="lora-base-model">Base model</Label>
				<select
					className={selectClassName}
					id="lora-base-model"
					onChange={(event) =>
						setBaseModel(event.target.value as LoraBaseModel)
					}
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
					onChange={(event) => setSourceUrl(event.target.value)}
					placeholder="https://civitai.com/api/download/models/..."
					value={sourceUrl}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="lora-default-weight">Default weight</Label>
				<Input
					id="lora-default-weight"
					onChange={(event) => setDefaultWeight(event.target.value)}
					step="0.05"
					type="number"
					value={defaultWeight}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="lora-description">Description</Label>
				<Input
					id="lora-description"
					onChange={(event) => setDescription(event.target.value)}
					placeholder="Optional"
					value={description}
				/>
			</div>
			<div className="md:col-span-2">
				<Button disabled={create.isPending} type="submit">
					{create.isPending ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Plus className="size-3.5" />
					)}
					Add LoRA
				</Button>
			</div>
		</form>
	);
}
