"use client";

import type {
	LoraBaseModel,
	LoraSourceProvider,
} from "@generator/contracts/loras";
import { LORA_BASE_MODELS } from "@generator/contracts/loras";
import { Button } from "@generator/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { formatBytes } from "@generator/ui/lib/format";
import { Eye, Loader2, Plus } from "lucide-react";
import Image from "next/image";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { useCreateLora, usePreviewLoraSource } from "@/hooks/use-admin-loras";

const baseModelLabels: Record<LoraBaseModel, string> = {
	"z-image": "Z-Image",
	flux: "Flux",
	sdxl: "SDXL",
	other: "Other",
};

const sourceProviderLabels: Record<LoraSourceProvider, string> = {
	auto: "Auto",
	civitai: "Civitai",
	direct: "Direct URL",
	huggingface: "Hugging Face",
};

const sourceProviderHints: Record<LoraSourceProvider, string> = {
	auto: "Detects Civitai, Hugging Face, or direct file URLs.",
	civitai: "Accepts Civitai model, model-version, or download URLs.",
	direct: "Downloads the URL exactly as provided.",
	huggingface: "Accepts a Hugging Face file URL, or repo URL plus file path.",
};

const selectClassName =
	"flex h-9 w-full rounded-md border border-foreground/10 bg-transparent px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

export default function LoraForm() {
	const create = useCreateLora();
	const preview = usePreviewLoraSource();
	const [name, setName] = useState("");
	const [sourceUrl, setSourceUrl] = useState("");
	const [sourceProvider, setSourceProvider] =
		useState<LoraSourceProvider>("auto");
	const [sourceFilePath, setSourceFilePath] = useState("");
	const [sourceRevision, setSourceRevision] = useState("");
	const [baseModel, setBaseModel] = useState<LoraBaseModel>("z-image");
	const [defaultWeight, setDefaultWeight] = useState("1");
	const [description, setDescription] = useState("");
	const sourceSupportsPreview =
		sourceProvider === "auto" || sourceProvider === "civitai";

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!sourceUrl) {
			toast.error("Source URL is required");
			return;
		}
		try {
			const weight = Number(defaultWeight);
			const lora = await create.mutateAsync({
				name: name.trim() || undefined,
				sourceUrl: sourceUrl.trim(),
				sourceProvider,
				sourceFilePath: sourceFilePath.trim() || undefined,
				sourceRevision: sourceRevision.trim() || undefined,
				baseModel,
				defaultWeight: Number.isFinite(weight) ? weight : 1,
				description: description.trim() || undefined,
			});
			toast.success(`Added LoRA "${lora.name}"`);
			setName("");
			setSourceUrl("");
			setSourceFilePath("");
			setSourceRevision("");
			setDescription("");
			setDefaultWeight("1");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to add LoRA"
			);
		}
	}

	async function handlePreview() {
		if (!sourceUrl) {
			toast.error("Source URL is required");
			return;
		}
		try {
			const result = await preview.mutateAsync({
				sourceProvider,
				sourceUrl: sourceUrl.trim(),
			});
			if (result.name && !name) {
				setName(result.name);
			}
			if (result.baseModel) {
				setBaseModel(result.baseModel);
			}
			if (result.description && !description) {
				setDescription(result.description);
			}
			toast.success("Civitai preview loaded");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to preview LoRA"
			);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Add LoRA</CardTitle>
				<CardDescription>
					Import from Civitai, Hugging Face, or a direct file URL.
				</CardDescription>
			</CardHeader>
			<form onSubmit={handleSubmit}>
				<CardContent className="grid gap-3 md:grid-cols-2">
					<div className="grid gap-1.5">
						<Label htmlFor="lora-source-provider">Source</Label>
						<select
							className={selectClassName}
							id="lora-source-provider"
							onChange={(event) =>
								setSourceProvider(event.target.value as LoraSourceProvider)
							}
							value={sourceProvider}
						>
							{Object.entries(sourceProviderLabels).map(([provider, label]) => (
								<option key={provider} value={provider}>
									{label}
								</option>
							))}
						</select>
						<p className="text-muted-foreground text-xs">
							{sourceProviderHints[sourceProvider]}
						</p>
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
						<div className="flex flex-col gap-2 sm:flex-row">
							<Input
								id="lora-source-url"
								onChange={(event) => setSourceUrl(event.target.value)}
								placeholder="https://civitai.com/models/... or https://huggingface.co/org/repo"
								value={sourceUrl}
							/>
							<Button
								disabled={preview.isPending || !sourceSupportsPreview}
								onClick={handlePreview}
								type="button"
								variant="outline"
							>
								{preview.isPending ? (
									<Loader2 className="animate-spin" data-icon="inline-start" />
								) : (
									<Eye data-icon="inline-start" />
								)}
								Preview
							</Button>
						</div>
					</div>
					{preview.data ? (
						<div className="grid gap-3 rounded-md border border-foreground/10 bg-muted/20 p-3 md:col-span-2 md:grid-cols-[96px_minmax(0,1fr)] dark:bg-muted/10">
							{preview.data.previewImageUrl ? (
								<div className="relative aspect-square overflow-hidden rounded-md bg-muted">
									<Image
										alt={preview.data.name ?? "Civitai LoRA preview"}
										className="object-cover"
										fill
										sizes="96px"
										src={preview.data.previewImageUrl}
									/>
								</div>
							) : null}
							<div className="grid min-w-0 gap-2">
								<div className="grid gap-1">
									<p className="truncate font-medium text-sm">
										{preview.data.name ?? "Unnamed Civitai LoRA"}
									</p>
									<p className="text-muted-foreground text-xs">
										{[
											preview.data.versionName,
											preview.data.baseModel,
											preview.data.fileName,
											preview.data.sizeBytes
												? formatBytes(preview.data.sizeBytes)
												: undefined,
										]
											.filter(Boolean)
											.join(" / ")}
									</p>
								</div>
								{preview.data.trainedWords &&
								preview.data.trainedWords.length > 0 ? (
									<div className="flex flex-wrap gap-1">
										{preview.data.trainedWords.map((word) => (
											<span
												className="rounded border border-foreground/10 px-1.5 py-0.5 text-[11px]"
												key={word}
											>
												{word}
											</span>
										))}
									</div>
								) : null}
								{preview.data.description ? (
									<p className="line-clamp-3 text-muted-foreground text-xs">
										{preview.data.description}
									</p>
								) : null}
							</div>
						</div>
					) : null}
					{sourceProvider === "huggingface" ? (
						<>
							<div className="grid gap-1.5">
								<Label htmlFor="lora-source-file-path">HF file path</Label>
								<Input
									id="lora-source-file-path"
									onChange={(event) => setSourceFilePath(event.target.value)}
									placeholder="loras/style.safetensors"
									value={sourceFilePath}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="lora-source-revision">HF revision</Label>
								<Input
									id="lora-source-revision"
									onChange={(event) => setSourceRevision(event.target.value)}
									placeholder="main"
									value={sourceRevision}
								/>
							</div>
						</>
					) : null}
					<div className="grid gap-1.5">
						<Label htmlFor="lora-name">Name</Label>
						<Input
							id="lora-name"
							onChange={(event) => setName(event.target.value)}
							placeholder="Optional for Civitai/HF"
							value={name}
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
					<div className="grid gap-1.5 md:col-span-2">
						<Label htmlFor="lora-description">Description</Label>
						<Input
							id="lora-description"
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Optional"
							value={description}
						/>
					</div>
				</CardContent>
				<CardFooter>
					<Button disabled={create.isPending} type="submit">
						{create.isPending ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<Plus data-icon="inline-start" />
						)}
						Add LoRA
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
