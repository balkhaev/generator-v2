"use client";

import {
	getBaseModelLabel,
	groupBaseModelsByFamily,
} from "@generator/contracts/base-models";
import type {
	LoraBaseModel,
	LoraRegistryEntry,
} from "@generator/contracts/loras";
import { Button } from "@generator/ui/components/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@generator/ui/components/dialog";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { SectionLabel } from "@generator/ui/components/section-label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectGroupLabel,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@generator/ui/components/select";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatBytes, formatDateTime } from "@generator/ui/lib/format";
import {
	Archive,
	ExternalLink,
	Link2,
	Loader2,
	RotateCcw,
	Save,
	Tags,
	Trash2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	useArchiveLora,
	useDeleteLora,
	useUpdateLora,
} from "@/hooks/use-admin-loras";

function variantLabel(variant: LoraRegistryEntry["variant"]) {
	if (variant === "high") {
		return "high noise";
	}
	if (variant === "low") {
		return "low noise";
	}
	return "both transformers";
}

const baseModelGroups = groupBaseModelsByFamily();

const baseModelItems = baseModelGroups.flatMap((group) =>
	group.models.map((model) => ({ label: model.label, value: model.id }))
);

interface FormState {
	baseModel: LoraBaseModel;
	defaultWeight: string;
	description: string;
	name: string;
	triggerWords: string;
}

function toFormState(entry: LoraRegistryEntry): FormState {
	return {
		baseModel: entry.baseModel,
		defaultWeight: String(entry.defaultWeight),
		description: entry.description,
		name: entry.name,
		triggerWords: entry.triggerWords.join(", "),
	};
}

function parseTriggerWordsInput(value: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of value.split(",")) {
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

function arrayEquals(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="grid gap-1">
			<SectionLabel>{label}</SectionLabel>
			<div className="break-all text-xs">{value}</div>
		</div>
	);
}

function LoraReadonlyMetadata({
	lora,
	paired,
}: {
	lora: LoraRegistryEntry;
	paired: LoraRegistryEntry | null;
}) {
	return (
		<section className="grid gap-3">
			<SectionLabel>Metadata</SectionLabel>
			<Field label="Slug" value={<code>{lora.slug}</code>} />
			<Field
				label="Stored base model"
				value={
					<span className="inline-flex items-center gap-1.5">
						<code className="text-[11px]">{lora.baseModel}</code>
						<span className="text-muted-foreground">
							({getBaseModelLabel(lora.baseModel)})
						</span>
					</span>
				}
			/>
			{lora.sourceProvider ? (
				<Field label="Source provider" value={lora.sourceProvider} />
			) : null}
			{lora.variant ? (
				<Field label="Variant" value={variantLabel(lora.variant)} />
			) : null}
			{lora.pairGroupId ? (
				<Field
					label="Pair"
					value={
						paired ? (
							<Link
								className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
								href={`/loras?id=${paired.id}` as Route}
							>
								<Link2 className="size-3" />
								<span className="break-all">{paired.name}</span>
								{paired.variant && paired.variant !== "both" ? (
									<span className="text-muted-foreground">
										({variantLabel(paired.variant)})
									</span>
								) : null}
							</Link>
						) : (
							<span className="inline-flex items-center gap-1 text-muted-foreground">
								<Link2 className="size-3" />
								<code className="text-[11px]">{lora.pairGroupId}</code>
								<span>(paired entry not found)</span>
							</span>
						)
					}
				/>
			) : null}
			<Field label="Size" value={formatBytes(lora.sizeBytes)} />
			<Field
				label="S3 URL"
				value={
					<a
						className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
						href={lora.s3Url}
						rel="noopener noreferrer"
						target="_blank"
					>
						<span className="break-all">{lora.s3Url}</span>
						<ExternalLink className="size-3" />
					</a>
				}
			/>
			<Field
				label="S3 key"
				value={<code className="text-[11px]">{lora.s3Key}</code>}
			/>
			{lora.sourceUrl ? (
				<Field
					label="Source"
					value={
						<a
							className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
							href={lora.sourceUrl}
							rel="noopener noreferrer"
							target="_blank"
						>
							<span className="break-all">{lora.sourceUrl}</span>
							<ExternalLink className="size-3" />
						</a>
					}
				/>
			) : null}
			<Field label="Created" value={formatDateTime(lora.createdAt)} />
			<Field label="Updated" value={formatDateTime(lora.updatedAt)} />
		</section>
	);
}

export default function LoraDetail({
	lora,
	paired,
}: {
	lora: LoraRegistryEntry | null;
	paired?: LoraRegistryEntry | null;
}) {
	if (!lora) {
		return (
			<div className="grid h-full place-items-center px-4 py-8">
				<EmptyState
					hint="Select an entry on the left to inspect or edit."
					icon={Tags}
					message="No LoRA selected"
				/>
			</div>
		);
	}

	return <LoraEditor key={lora.id} lora={lora} paired={paired ?? null} />;
}

function LoraEditor({
	lora,
	paired,
}: {
	lora: LoraRegistryEntry;
	paired: LoraRegistryEntry | null;
}) {
	const update = useUpdateLora();
	const archive = useArchiveLora();
	const remove = useDeleteLora();
	const [form, setForm] = useState<FormState>(() => toFormState(lora));
	const [confirmOpen, setConfirmOpen] = useState(false);

	useEffect(() => {
		setForm(toFormState(lora));
	}, [lora]);

	const parsedTriggerWords = parseTriggerWordsInput(form.triggerWords);
	const isDirty =
		form.name.trim() !== lora.name ||
		form.description.trim() !== lora.description ||
		form.baseModel !== lora.baseModel ||
		Number(form.defaultWeight) !== lora.defaultWeight ||
		!arrayEquals(parsedTriggerWords, lora.triggerWords);

	async function handleSave() {
		const trimmedName = form.name.trim();
		if (!trimmedName) {
			toast.error("Name is required");
			return;
		}
		const weight = Number(form.defaultWeight);
		if (!Number.isFinite(weight)) {
			toast.error("Default weight must be a number");
			return;
		}
		try {
			await update.mutateAsync({
				id: lora.id,
				patch: {
					name: trimmedName,
					description: form.description.trim(),
					baseModel: form.baseModel,
					defaultWeight: weight,
					triggerWords: parsedTriggerWords,
				},
			});
			toast.success("LoRA updated");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to update LoRA"
			);
		}
	}

	async function handleArchiveToggle() {
		try {
			if (lora.status === "active") {
				await archive.mutateAsync(lora.id);
				toast.success("LoRA archived");
			} else {
				await update.mutateAsync({
					id: lora.id,
					patch: { status: "active" },
				});
				toast.success("LoRA restored");
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to update status"
			);
		}
	}

	async function handleDelete() {
		try {
			await remove.mutateAsync(lora.id);
			toast.success("LoRA deleted");
			setConfirmOpen(false);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete LoRA"
			);
		}
	}

	const isBusy = update.isPending || archive.isPending || remove.isPending;

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
			<div className="border-foreground/6 border-b px-4 py-3 dark:border-foreground/10">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<SectionLabel>Inspector</SectionLabel>
					<div className="flex flex-wrap items-center gap-1.5">
						{lora.variant && lora.variant !== "both" ? (
							<StatusBadge tone={lora.variant === "high" ? "info" : "accent"}>
								{variantLabel(lora.variant)}
							</StatusBadge>
						) : null}
						<StatusBadge
							tone={lora.status === "active" ? "success" : "warning"}
						>
							{lora.status}
						</StatusBadge>
					</div>
				</div>
			</div>

			<div className="grid min-h-0 gap-5 overflow-y-auto px-4 py-4">
				<section className="grid gap-3">
					<SectionLabel>Edit</SectionLabel>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="lora-edit-name">
							Name
						</Label>
						<Input
							id="lora-edit-name"
							onChange={(event) =>
								setForm((prev) => ({ ...prev, name: event.target.value }))
							}
							value={form.name}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="lora-edit-description">
							Description
						</Label>
						<Input
							id="lora-edit-description"
							onChange={(event) =>
								setForm((prev) => ({
									...prev,
									description: event.target.value,
								}))
							}
							placeholder="Optional"
							value={form.description}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="lora-edit-base-model">
							Base model
						</Label>
						<Select
							items={baseModelItems}
							onValueChange={(value) =>
								setForm((prev) => ({
									...prev,
									baseModel: (value ?? prev.baseModel) as LoraBaseModel,
								}))
							}
							value={form.baseModel}
						>
							<SelectTrigger className="w-full" id="lora-edit-base-model">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
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
						<p className="text-[11px] text-muted-foreground">
							Studio and Persons filter LoRAs by base model — keep this in sync
							with the workflow you intend to use.
						</p>
					</div>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="lora-edit-weight">
							Default weight
						</Label>
						<Input
							id="lora-edit-weight"
							onChange={(event) =>
								setForm((prev) => ({
									...prev,
									defaultWeight: event.target.value,
								}))
							}
							step="0.05"
							type="number"
							value={form.defaultWeight}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label className="text-xs" htmlFor="lora-edit-trigger-words">
							Trigger words
						</Label>
						<Input
							id="lora-edit-trigger-words"
							onChange={(event) =>
								setForm((prev) => ({
									...prev,
									triggerWords: event.target.value,
								}))
							}
							placeholder="e.g. mystic, neon city"
							value={form.triggerWords}
						/>
						<p className="text-[11px] text-muted-foreground">
							Comma-separated. Studio will prepend these to the user prompt
							whenever this LoRA is selected so the model actually triggers it.
						</p>
						{parsedTriggerWords.length > 0 ? (
							<div className="flex flex-wrap gap-1">
								{parsedTriggerWords.map((word) => (
									<span
										className="rounded border border-foreground/10 px-1.5 py-0.5 text-[11px]"
										key={word}
									>
										{word}
									</span>
								))}
							</div>
						) : null}
					</div>
				</section>

				<LoraReadonlyMetadata lora={lora} paired={paired} />
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 border-foreground/6 border-t bg-muted/20 px-4 py-3 dark:border-foreground/10">
				<div className="flex items-center gap-2">
					<Button disabled={!isDirty || isBusy} onClick={handleSave} size="sm">
						{update.isPending ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<Save data-icon="inline-start" />
						)}
						Save
					</Button>
					<Button
						disabled={isBusy}
						onClick={handleArchiveToggle}
						size="sm"
						variant="outline"
					>
						{lora.status === "active" ? (
							<>
								<Archive data-icon="inline-start" />
								Archive
							</>
						) : (
							<>
								<RotateCcw data-icon="inline-start" />
								Restore
							</>
						)}
					</Button>
				</div>
				<Button
					disabled={isBusy}
					onClick={() => setConfirmOpen(true)}
					size="sm"
					variant="ghost"
				>
					<Trash2 data-icon="inline-start" />
					Delete
				</Button>
			</div>

			<Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Delete &ldquo;{lora.name}&rdquo;?</DialogTitle>
						<DialogDescription>
							This permanently removes the registry entry. The cached file in S3
							is not affected. Workflows referencing this LoRA by URL will keep
							working until the file is removed.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<p className="text-muted-foreground text-xs">
							If you only want to hide this LoRA from Studio and Persons, use
							<span className="mx-1 font-medium">Archive</span>
							instead — you can restore it later.
						</p>
					</DialogBody>
					<DialogFooter>
						<Button
							onClick={() => setConfirmOpen(false)}
							size="sm"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={remove.isPending}
							onClick={handleDelete}
							size="sm"
						>
							{remove.isPending ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<Trash2 data-icon="inline-start" />
							)}
							Delete permanently
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
