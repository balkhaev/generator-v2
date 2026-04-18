"use client";

import { getBaseModelLabel } from "@generator/contracts/base-models";
import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { Button } from "@generator/ui/components/button";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { formatBytes } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import { Archive, ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { useArchiveLora, useUpdateLora } from "@/hooks/use-admin-loras";

export default function LoraRow({
	isSelected,
	lora,
	onSelect,
}: {
	isSelected: boolean;
	lora: LoraRegistryEntry;
	onSelect: (id: string) => void;
}) {
	const archive = useArchiveLora();
	const update = useUpdateLora();

	async function handleArchive(event: React.MouseEvent) {
		event.stopPropagation();
		try {
			await archive.mutateAsync(lora.id);
			toast.success("LoRA archived");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to archive LoRA"
			);
		}
	}

	async function handleRestore(event: React.MouseEvent) {
		event.stopPropagation();
		try {
			await update.mutateAsync({
				id: lora.id,
				patch: { status: "active" },
			});
			toast.success("LoRA restored");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to restore LoRA"
			);
		}
	}

	return (
		<button
			aria-current={isSelected}
			className={cn(
				"grid w-full items-center gap-2 rounded-md border border-transparent px-3 py-2.5 text-left transition",
				isSelected
					? "border-foreground/15 bg-muted/35"
					: "bg-muted/15 hover:bg-muted/25 dark:bg-muted/8"
			)}
			onClick={() => onSelect(lora.id)}
			type="button"
		>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
				<div className="grid min-w-0 gap-1">
					<div className="flex items-center gap-2">
						<p className="truncate font-medium text-sm">{lora.name}</p>
						<StatusBadge tone="neutral">
							{getBaseModelLabel(lora.baseModel)}
						</StatusBadge>
						{lora.variant && lora.variant !== "both" ? (
							<StatusBadge tone={lora.variant === "high" ? "info" : "accent"}>
								{lora.variant === "high" ? "high noise" : "low noise"}
							</StatusBadge>
						) : null}
						{lora.status === "archived" ? (
							<StatusBadge tone="warning">archived</StatusBadge>
						) : null}
					</div>
					<p className="truncate text-[11px] text-muted-foreground">
						<span className="font-mono">{lora.slug}</span>
						{" · "}weight {lora.defaultWeight}
						{" · "}
						{formatBytes(lora.sizeBytes)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{lora.status === "active" ? (
						<Button
							disabled={archive.isPending}
							onClick={handleArchive}
							size="xs"
							variant="outline"
						>
							<Archive className="size-3" />
							Archive
						</Button>
					) : (
						<Button
							disabled={update.isPending}
							onClick={handleRestore}
							size="xs"
							variant="outline"
						>
							<RotateCcw className="size-3" />
							Restore
						</Button>
					)}
					<ChevronRight className="size-3.5 text-muted-foreground" />
				</div>
			</div>
		</button>
	);
}
