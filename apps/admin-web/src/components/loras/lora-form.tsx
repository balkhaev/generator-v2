"use client";

import type {
	LoraBaseModel,
	LoraSourcePreview,
	LoraSourcePreviewVariant,
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
import { cn } from "@generator/ui/lib/utils";
import { ChevronDown, Eye, Loader2, Plus } from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";

import { useCreateLora, usePreviewLoraSource } from "@/hooks/use-admin-loras";

const baseModelLabels: Record<LoraBaseModel, string> = {
	"z-image": "Z-Image",
	flux: "Flux",
	sdxl: "SDXL",
	other: "Other",
};

const selectClassName =
	"flex h-9 w-full rounded-md border border-foreground/10 bg-transparent px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";
const civitaiHostPattern = /(^|\.)civitai\.(com|red)$/iu;
const videoUrlPattern = /\.(mp4|webm)(\?|$)/iu;
const importProgressSteps = [
	{ label: "Resolve source", pct: 12 },
	{ label: "Download LoRA", pct: 34 },
	{ label: "Upload to S3", pct: 72 },
	{ label: "Save registry entry", pct: 92 },
] as const;

function isCivitaiUrl(value: string): boolean {
	try {
		return civitaiHostPattern.test(new URL(value).hostname);
	} catch {
		return false;
	}
}

function inferMediaType(url: string | undefined) {
	return url && videoUrlPattern.test(url) ? "video" : "image";
}

function formatElapsed(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return minutes > 0
		? `${minutes}:${rest.toString().padStart(2, "0")}`
		: `${rest}s`;
}

function getImportProgress(elapsedSeconds: number) {
	if (elapsedSeconds < 2) {
		return importProgressSteps[0];
	}
	if (elapsedSeconds < 8) {
		return importProgressSteps[1];
	}
	if (elapsedSeconds < 20) {
		return importProgressSteps[2];
	}
	return importProgressSteps[3];
}

function ImportProgress({ elapsedSeconds }: { elapsedSeconds: number }) {
	const step = getImportProgress(elapsedSeconds);
	return (
		<div className="grid gap-2 md:col-span-2">
			<div className="flex items-center justify-between gap-3 text-xs">
				<span className="text-muted-foreground">{step.label}</span>
				<span className="tabular-nums">
					{step.pct}% / {formatElapsed(elapsedSeconds)}
				</span>
			</div>
			<div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
				<div
					className="h-full rounded-full bg-foreground transition-[width]"
					style={{ width: `${step.pct}%` }}
				/>
			</div>
			<p className="text-muted-foreground text-xs">
				Large LoRA files can take a while while the server downloads and caches
				the weights.
			</p>
		</div>
	);
}

function PreviewMedia({
	alt,
	mediaType,
	mediaUrl,
}: {
	alt: string;
	mediaType: "image" | "video";
	mediaUrl: string;
}) {
	return (
		<div className="relative aspect-square overflow-hidden rounded-md bg-muted">
			{mediaType === "video" ? (
				<video
					aria-label={alt}
					autoPlay
					className="size-full object-cover"
					loop
					muted
					playsInline
					src={mediaUrl}
				/>
			) : (
				// biome-ignore lint/performance/noImgElement: Civitai media can be video or image, so this renderer bypasses Next image optimization.
				<img
					alt={alt}
					className="size-full object-cover"
					height={96}
					src={mediaUrl}
					width={96}
				/>
			)}
		</div>
	);
}

function PreviewCard({
	activeVariant,
	onVersionChange,
	preview,
	selectedVersionId,
}: {
	activeVariant: LoraSourcePreviewVariant | null;
	onVersionChange: (versionId: number) => void;
	preview: LoraSourcePreview;
	selectedVersionId: number | null;
}) {
	const mediaUrl =
		activeVariant?.mediaUrl ??
		preview.previewMediaUrl ??
		preview.previewImageUrl;
	const mediaType =
		activeVariant?.mediaType ??
		preview.previewMediaType ??
		inferMediaType(mediaUrl);
	const baseModel = activeVariant?.baseModel ?? preview.baseModel;
	const description = activeVariant?.description ?? preview.description;
	const fileName = activeVariant?.fileName ?? preview.fileName;
	const sizeBytes = activeVariant?.sizeBytes ?? preview.sizeBytes;
	const trainedWords = activeVariant?.trainedWords ?? preview.trainedWords;
	const versionName = activeVariant?.versionName ?? preview.versionName;

	return (
		<div className="grid gap-3 rounded-md border border-foreground/10 bg-muted/20 p-3 md:col-span-2 md:grid-cols-[96px_minmax(0,1fr)] dark:bg-muted/10">
			{mediaUrl ? (
				<PreviewMedia
					alt={preview.name ?? "Civitai LoRA preview"}
					mediaType={mediaType}
					mediaUrl={mediaUrl}
				/>
			) : null}
			<div className="grid min-w-0 gap-2">
				{preview.variants && preview.variants.length > 1 ? (
					<div className="grid gap-1">
						<Label htmlFor="lora-source-version">Version</Label>
						<select
							className={selectClassName}
							id="lora-source-version"
							onChange={(event) => onVersionChange(Number(event.target.value))}
							value={selectedVersionId ?? ""}
						>
							{preview.variants.map((variant) => (
								<option key={variant.versionId} value={variant.versionId}>
									{[
										variant.versionName,
										variant.baseModel,
										variant.fileName,
										variant.sizeBytes
											? formatBytes(variant.sizeBytes)
											: undefined,
									]
										.filter(Boolean)
										.join(" / ")}
								</option>
							))}
						</select>
					</div>
				) : null}
				<div className="grid gap-1">
					<p className="truncate font-medium text-sm">
						{preview.name ?? "Unnamed Civitai LoRA"}
					</p>
					<p className="text-muted-foreground text-xs">
						{[
							versionName,
							baseModel,
							fileName,
							sizeBytes ? formatBytes(sizeBytes) : undefined,
						]
							.filter(Boolean)
							.join(" / ")}
					</p>
				</div>
				{trainedWords && trainedWords.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{trainedWords.map((word) => (
							<span
								className="rounded border border-foreground/10 px-1.5 py-0.5 text-[11px]"
								key={word}
							>
								{word}
							</span>
						))}
					</div>
				) : null}
				{description ? (
					<p className="line-clamp-3 text-muted-foreground text-xs">
						{description}
					</p>
				) : null}
			</div>
		</div>
	);
}

export default function LoraForm() {
	const create = useCreateLora();
	const {
		data: previewData,
		isPending: isPreviewPending,
		mutateAsync: previewSource,
		reset: resetPreview,
	} = usePreviewLoraSource();
	const [name, setName] = useState("");
	const [sourceUrl, setSourceUrl] = useState("");
	const [selectedVersionId, setSelectedVersionId] = useState<number | null>(
		null
	);
	const [baseModel, setBaseModel] = useState<LoraBaseModel>("z-image");
	const [defaultWeight, setDefaultWeight] = useState("1");
	const [description, setDescription] = useState("");
	const [importStartedAt, setImportStartedAt] = useState<number | null>(null);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [formOpen, setFormOpen] = useState(false);
	const trimmedSourceUrl = sourceUrl.trim();
	const activeVariant = useMemo(
		() =>
			previewData?.variants?.find(
				(variant) => variant.versionId === selectedVersionId
			) ?? null,
		[previewData?.variants, selectedVersionId]
	);
	const applyPreviewFields = useCallback(
		(result: {
			baseModel?: LoraBaseModel;
			description?: string;
			name?: string;
			sourceVersionId?: number;
			variants?: { versionId: number }[];
		}) => {
			if (result.name) {
				setName((current) => current || result.name || "");
			}
			if (result.baseModel) {
				setBaseModel(result.baseModel);
			}
			if (result.description) {
				setDescription((current) => current || result.description || "");
			}
			setSelectedVersionId(
				result.sourceVersionId ?? result.variants?.[0]?.versionId ?? null
			);
		},
		[]
	);

	const loadPreview = useCallback(
		async (options: { silent?: boolean; versionId?: number } = {}) => {
			if (!trimmedSourceUrl) {
				toast.error("Source URL is required");
				return;
			}
			try {
				const result = await previewSource({
					sourceUrl: trimmedSourceUrl,
					sourceVersionId: options.versionId,
				});
				applyPreviewFields(result);
				if (!options.silent) {
					toast.success("Civitai preview loaded");
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to preview LoRA"
				);
			}
		},
		[applyPreviewFields, previewSource, trimmedSourceUrl]
	);

	useEffect(() => {
		if (!isCivitaiUrl(trimmedSourceUrl)) {
			setSelectedVersionId(null);
			resetPreview();
			return;
		}
		const timeout = setTimeout(() => {
			loadPreview({ silent: true });
		}, 500);
		return () => clearTimeout(timeout);
	}, [loadPreview, resetPreview, trimmedSourceUrl]);

	useEffect(() => {
		if (!importStartedAt) {
			setElapsedSeconds(0);
			return;
		}
		const updateElapsed = () => {
			setElapsedSeconds(
				Math.max(0, Math.floor((Date.now() - importStartedAt) / 1000))
			);
		};
		updateElapsed();
		const interval = window.setInterval(updateElapsed, 1000);
		return () => window.clearInterval(interval);
	}, [importStartedAt]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!trimmedSourceUrl) {
			toast.error("Source URL is required");
			return;
		}
		setImportStartedAt(Date.now());
		try {
			const weight = Number(defaultWeight);
			const lora = await create.mutateAsync({
				name: name.trim() || undefined,
				sourceUrl: trimmedSourceUrl,
				sourceVersionId: selectedVersionId ?? undefined,
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
		} finally {
			setImportStartedAt(null);
		}
	}

	function handleVersionChange(versionId: number) {
		setSelectedVersionId(versionId);
		const variant = previewData?.variants?.find(
			(item) => item.versionId === versionId
		);
		if (!variant) {
			return;
		}
		if (variant.baseModel) {
			setBaseModel(variant.baseModel);
		}
		if (variant.description) {
			setDescription((current) => current || variant.description || "");
		}
	}

	return (
		<Card>
			<CardHeader className="p-0">
				<button
					aria-controls="add-lora-form"
					aria-expanded={formOpen}
					className="flex w-full items-start gap-3 rounded-none px-4 py-4 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					onClick={() => setFormOpen((open) => !open)}
					type="button"
				>
					<span className="grid min-w-0 flex-1 gap-1">
						<CardTitle>Add LoRA</CardTitle>
						<CardDescription>
							Import from Civitai, Hugging Face, or a direct file URL.
						</CardDescription>
					</span>
					<ChevronDown
						aria-hidden="true"
						className={cn(
							"mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
							formOpen ? "rotate-180" : ""
						)}
					/>
				</button>
			</CardHeader>
			<form
				className={formOpen ? "contents" : "hidden"}
				id="add-lora-form"
				onSubmit={handleSubmit}
			>
				<CardContent className="grid gap-3 md:grid-cols-2">
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
								placeholder="https://civitai.red/models/... or https://huggingface.co/org/repo/blob/main/lora.safetensors"
								value={sourceUrl}
							/>
							<Button
								disabled={isPreviewPending}
								onClick={() =>
									loadPreview({ versionId: selectedVersionId ?? undefined })
								}
								type="button"
								variant="outline"
							>
								{isPreviewPending ? (
									<Loader2 className="animate-spin" data-icon="inline-start" />
								) : (
									<Eye data-icon="inline-start" />
								)}
								Preview
							</Button>
						</div>
					</div>
					{previewData ? (
						<PreviewCard
							activeVariant={activeVariant}
							onVersionChange={handleVersionChange}
							preview={previewData}
							selectedVersionId={selectedVersionId}
						/>
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
					{create.isPending ? (
						<ImportProgress elapsedSeconds={elapsedSeconds} />
					) : null}
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
