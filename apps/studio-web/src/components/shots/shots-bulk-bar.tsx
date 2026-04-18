"use client";

import { Button } from "@generator/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import { CheckCheck, Copy, Download, Loader2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export interface BulkSelectionItem {
	artifactKind: "image" | "video";
	fullUrl: string;
	id: string;
	kind: "studio" | "person" | "dataset";
	title: string;
}

interface ShotsBulkBarProps {
	deletableCount: number;
	isBusy: boolean;
	items: BulkSelectionItem[];
	onClear: () => void;
	onDeleteSelected: () => Promise<void> | void;
	onSelectAll: () => void;
	totalVisible: number;
}

const FILENAME_SAFE_PATTERN = /[^\w\d.-]+/g;
const URL_EXT_PATTERN = /\.(jpe?g|png|webp|gif|mp4|webm|mov|m4v)(?:$|\?)/i;

function inferExtension(item: BulkSelectionItem): string {
	try {
		const path = new URL(item.fullUrl).pathname;
		const match = path.match(URL_EXT_PATTERN);
		if (match) {
			return `.${match[1].toLowerCase()}`;
		}
	} catch {
		// noop
	}
	return item.artifactKind === "video" ? ".mp4" : ".jpg";
}

function inferDownloadName(item: BulkSelectionItem, index: number) {
	const base = (item.title || `shot-${index + 1}`)
		.replace(FILENAME_SAFE_PATTERN, "-")
		.slice(0, 60);
	return `${base || "shot"}-${item.id}${inferExtension(item)}`;
}

async function downloadOne(item: BulkSelectionItem, index: number) {
	const filename = inferDownloadName(item, index);
	try {
		const response = await fetch(item.fullUrl, {
			credentials: "omit",
			mode: "cors",
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = filename;
		document.body.append(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		return true;
	} catch {
		// CORS-blocked or network failure — fall back to opening in new tab.
		const link = document.createElement("a");
		link.href = item.fullUrl;
		link.target = "_blank";
		link.rel = "noreferrer";
		link.download = filename;
		document.body.append(link);
		link.click();
		link.remove();
		return false;
	}
}

export default function ShotsBulkBar({
	deletableCount,
	isBusy,
	items,
	onClear,
	onDeleteSelected,
	onSelectAll,
	totalVisible,
}: ShotsBulkBarProps) {
	const [isDownloading, setIsDownloading] = useState(false);
	const selectedCount = items.length;
	const allSelected = selectedCount > 0 && selectedCount === totalVisible;

	const handleCopyLinks = async () => {
		try {
			await navigator.clipboard.writeText(
				items.map((item) => item.fullUrl).join("\n")
			);
			toast.success(
				selectedCount === 1
					? "Ссылка скопирована"
					: `Скопировано ${selectedCount} ссылок`
			);
		} catch {
			toast.error("Не удалось скопировать ссылки");
		}
	};

	const handleDownload = async () => {
		if (isDownloading || selectedCount === 0) {
			return;
		}
		setIsDownloading(true);
		const toastId = toast.loading(`Скачиваем ${selectedCount}…`);
		let okCount = 0;
		let fallbackCount = 0;
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			if (!item) {
				continue;
			}
			// eslint-disable-next-line no-await-in-loop -- sequential downloads avoid browser popup blocker
			const ok = await downloadOne(item, index);
			if (ok) {
				okCount += 1;
			} else {
				fallbackCount += 1;
			}
			// Small gap so браузер успевает обработать предыдущий download.
			// eslint-disable-next-line no-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		setIsDownloading(false);
		if (fallbackCount === 0) {
			toast.success(`Скачано ${okCount}`, { id: toastId });
		} else {
			toast.message(
				`Скачано ${okCount}, ${fallbackCount} открыто во вкладках (CORS).`,
				{ id: toastId }
			);
		}
	};

	return (
		<div
			aria-label="Действия над выделением"
			className={cn(
				"slide-in-from-top-2 sticky top-12 z-10 flex animate-in flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] px-2.5 py-2 shadow-sm backdrop-blur-xl duration-150"
			)}
			role="toolbar"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				<Button
					aria-label="Снять выделение"
					onClick={onClear}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<X className="size-3.5" />
				</Button>
				<span className="font-medium text-foreground text-xs tabular-nums">
					Выбрано {selectedCount}
				</span>
				<span className="text-[11px] text-muted-foreground">
					из {totalVisible}
				</span>
				{!allSelected && totalVisible > selectedCount ? (
					<Button
						className="text-xs"
						onClick={onSelectAll}
						size="xs"
						type="button"
						variant="ghost"
					>
						<CheckCheck className="size-3" />
						Выбрать все
					</Button>
				) : null}
			</div>

			<div className="flex shrink-0 flex-wrap items-center gap-1.5">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Скопировать ссылки"
								onClick={() => {
									handleCopyLinks().catch(() => undefined);
								}}
								size="sm"
								type="button"
								variant="ghost"
							>
								<Copy className="size-3.5" />
								<span className="sr-only sm:not-sr-only">Копировать</span>
							</Button>
						}
					/>
					<TooltipContent>Скопировать прямые ссылки</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Скачать выделенное"
								disabled={isDownloading}
								onClick={() => {
									handleDownload().catch(() => undefined);
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								{isDownloading ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Download className="size-3.5" />
								)}
								<span className="sr-only sm:not-sr-only">Скачать</span>
							</Button>
						}
					/>
					<TooltipContent>
						Скачать файлы (при CORS-блокировке откроются во вкладках)
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Удалить выделенные studio-shots"
								disabled={deletableCount === 0 || isBusy}
								onClick={() => {
									Promise.resolve(onDeleteSelected()).catch(() => undefined);
								}}
								size="sm"
								type="button"
								variant="destructive"
							>
								{isBusy ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Trash2 className="size-3.5" />
								)}
								<span className="sr-only sm:not-sr-only">
									{deletableCount > 0 ? `Удалить ${deletableCount}` : "Удалить"}
								</span>
							</Button>
						}
					/>
					<TooltipContent>
						{deletableCount === 0
							? "Удаление доступно только для studio-shots"
							: `Удалить ${deletableCount} studio-shots`}
					</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
