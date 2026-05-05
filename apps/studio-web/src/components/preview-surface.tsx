"use client";

import { RunProgressIndicator } from "@generator/ui/components/run-progress-indicator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import {
	Bookmark,
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	ExternalLink,
	Film,
	ImageIcon,
	Loader2,
	Maximize2,
	MonitorPlay,
	Send,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import IconButton from "./icon-button";
import VideoPlayer from "./video-player";

const toolbarLinkClass =
	"inline-flex size-7 items-center justify-center rounded-none text-muted-foreground transition hover:bg-muted hover:text-foreground";

const videoExtensionPattern = /\.(mp4|mov|webm)(\?.*)?$/i;
const videoDataUriPattern = /^data:video\//i;

export function getMediaType(url: string): "image" | "video" {
	if (videoExtensionPattern.test(url) || videoDataUriPattern.test(url)) {
		return "video";
	}

	return "image";
}

export interface StudioMediaAsset {
	createdAt: string;
	/** Грубая оценка остатка в миллисекундах — для overlay-индикатора прогресса. */
	etaMs?: number | null;
	/**
	 * Ожидаемая длительность ран'а из workflow-каталога (мс). Нужна для
	 * локальной soft-progress интерполяции между Kafka-апдейтами.
	 */
	expectedDurationMs?: number | null;
	id: string;
	label: string;
	/** Последняя строка лога, отображается под прогрессом. */
	lastLogLine?: string | null;
	mediaKind: "input" | "output";
	mediaType: "image" | "video";
	meta: string;
	/** Дискретная фаза для overlay-индикатора прогресса. */
	phase?: import("@generator/contracts/generator").ExecutionPhase | null;
	/**
	 * true, когда asset показывается как заглушка для будущего output:
	 * пока run в queued/running и реальных artefact'ов ещё нет, мы рендерим
	 * входное фото в том же слоте, где появится готовый результат.
	 */
	placeholder?: boolean;
	/**
	 * Картинка для предварительного отображения, пока сам ассет
	 * не загружен/не воспроизведён. Сейчас используется в media-strip,
	 * чтобы для видео-output показывать input-фотку как poster, если
	 * первый кадр из самого видео ещё не отрисовался.
	 */
	posterUrl?: string | null;
	progressPct?: number | null;
	/** Позиция в очереди провайдера для overlay-индикатора прогресса. */
	queuePosition?: number | null;
	runId: string;
	scenarioId: string;
	status: "queued" | "running" | "succeeded" | "failed";
	url: string;
}

function deriveDownloadName(asset: StudioMediaAsset) {
	const safeLabel = asset.label
		.replace(/[^a-zA-Z0-9_\- ]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.slice(0, 60);
	const extension = asset.mediaType === "video" ? "mp4" : "png";

	return `${safeLabel || asset.id}.${extension}`;
}

async function copyTextToClipboard(value: string) {
	if (typeof navigator !== "undefined" && navigator.clipboard) {
		await navigator.clipboard.writeText(value);
		return;
	}

	throw new Error("Clipboard API is not available.");
}

function renderImagePreview(asset: StudioMediaAsset) {
	return (
		<div
			aria-label={asset.label}
			className="h-full w-full bg-center bg-contain bg-no-repeat"
			role="img"
			style={{ backgroundImage: `url("${asset.url}")` }}
		/>
	);
}

function PreviewEmptyState() {
	return (
		<div className="studio-aurora flex h-full items-center justify-center">
			<div className="grid max-w-xs gap-3 text-center">
				<div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted/15 dark:bg-muted/10">
					<MonitorPlay
						className="size-5 text-muted-foreground/60"
						strokeWidth={1.5}
					/>
				</div>
				<p className="text-muted-foreground text-sm">No media selected</p>
				<p className="text-muted-foreground/60 text-xs leading-relaxed">
					Upload a source image and queue a run to see results here. Use the
					dock below to compose and launch.
				</p>
			</div>
		</div>
	);
}

function PreviewBadges({ asset }: { asset: StudioMediaAsset }) {
	const isPlaceholder = asset.placeholder === true;

	return (
		<div className="absolute top-2 left-2 flex items-center gap-1.5">
			{isPlaceholder ? (
				<span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-50 backdrop-blur-md">
					<RunProgressIndicator
						etaMs={asset.etaMs}
						expectedDurationMs={asset.expectedDurationMs}
						phase={asset.phase}
						progressMonotonicKey={asset.runId}
						progressPct={asset.progressPct}
						queuePosition={asset.queuePosition}
						runStartedAt={asset.createdAt}
						status={asset.status}
						variant="inline"
					/>
				</span>
			) : (
				<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-50 backdrop-blur-md">
					{asset.mediaKind}
				</span>
			)}
			<span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-[11px] backdrop-blur-md">
				{asset.mediaType === "video" ? (
					<Film className="size-3" />
				) : (
					<ImageIcon className="size-3" />
				)}
				{asset.mediaType}
			</span>
		</div>
	);
}

function PreviewProgressOverlay({ asset }: { asset: StudioMediaAsset }) {
	if (asset.placeholder !== true) {
		return null;
	}
	return (
		<div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-background/85 px-3 py-2 backdrop-blur-lg dark:bg-background/70">
			<RunProgressIndicator
				etaMs={asset.etaMs}
				expectedDurationMs={asset.expectedDurationMs}
				lastLogLine={asset.lastLogLine}
				phase={asset.phase}
				progressMonotonicKey={asset.runId}
				progressPct={asset.progressPct}
				queuePosition={asset.queuePosition}
				runStartedAt={asset.createdAt}
				status={asset.status}
			/>
		</div>
	);
}

function PreviewToolbar({
	asset,
	isFullscreen,
	isSavedShot,
	isSavingShot,
	onCopyUrl,
	onSaveShot,
	onSendToWorkflow,
	onToggleFullscreen,
}: {
	asset: StudioMediaAsset;
	isFullscreen: boolean;
	isSavedShot?: boolean;
	isSavingShot?: boolean;
	onCopyUrl: () => void;
	onSaveShot?: (asset: StudioMediaAsset) => void;
	onSendToWorkflow?: (asset: StudioMediaAsset) => void;
	onToggleFullscreen: () => void;
}) {
	const canSendToWorkflow =
		asset.mediaKind === "output" &&
		asset.mediaType === "image" &&
		asset.placeholder !== true &&
		Boolean(onSendToWorkflow);

	return (
		<div className="absolute top-2 right-2 flex items-center gap-1 rounded-lg bg-background/70 px-1 py-1 backdrop-blur-md">
			{canSendToWorkflow ? (
				<IconButton
					hint="Send to workflow"
					label="Send image to workflow as source"
					onClick={() => onSendToWorkflow?.(asset)}
				>
					<Send className="size-3.5" />
				</IconButton>
			) : null}
			{onSaveShot &&
			asset.mediaKind === "output" &&
			asset.placeholder !== true ? (
				<IconButton
					disabled={isSavingShot || isSavedShot}
					hint={isSavedShot ? "Saved as shot" : "Save as shot"}
					label={isSavedShot ? "Saved as shot" : "Save as shot"}
					onClick={() => onSaveShot(asset)}
				>
					{isSavingShot ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Bookmark
							className={cn(
								"size-3.5",
								isSavedShot && "fill-current text-amber-400"
							)}
						/>
					)}
				</IconButton>
			) : null}
			<IconButton hint="Copy URL" label="Copy media URL" onClick={onCopyUrl}>
				<Copy className="size-3.5" />
			</IconButton>
			<Tooltip>
				<TooltipTrigger
					render={
						<a
							aria-label="Open media in new tab"
							className={toolbarLinkClass}
							href={asset.url}
							rel="noopener noreferrer"
							target="_blank"
						>
							<ExternalLink className="size-3.5" />
							<span className="sr-only">Open media in new tab</span>
						</a>
					}
				/>
				<TooltipContent>Open in new tab</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<a
							aria-label="Download media"
							className={toolbarLinkClass}
							download={deriveDownloadName(asset)}
							href={asset.url}
							rel="noopener noreferrer"
							target="_blank"
						>
							<Download className="size-3.5" />
							<span className="sr-only">Download media</span>
						</a>
					}
				/>
				<TooltipContent>Download</TooltipContent>
			</Tooltip>
			<IconButton
				hint={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
				label="Toggle fullscreen"
				onClick={onToggleFullscreen}
			>
				<Maximize2 className="size-3.5" />
			</IconButton>
		</div>
	);
}

function PreviewNavigation({
	onNext,
	onPrevious,
}: {
	onNext?: () => void;
	onPrevious?: () => void;
}) {
	return (
		<div className="absolute top-1/2 right-2 left-2 flex -translate-y-1/2 items-center justify-between">
			<IconButton
				disabled={!onPrevious}
				hint="Previous (←)"
				label="Previous media"
				onClick={onPrevious}
				size="icon"
				variant="outline"
			>
				<ChevronLeft className="size-4" />
			</IconButton>
			<IconButton
				disabled={!onNext}
				hint="Next (→)"
				label="Next media"
				onClick={onNext}
				size="icon"
				variant="outline"
			>
				<ChevronRight className="size-4" />
			</IconButton>
		</div>
	);
}

function PreviewCounter({
	currentIndex,
	totalAssets,
}: {
	currentIndex: number;
	totalAssets: number;
}) {
	return (
		<span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
			{currentIndex + 1} / {totalAssets}
		</span>
	);
}

function PreviewBottomInfo({
	asset,
	currentIndex,
	totalAssets,
}: {
	asset: StudioMediaAsset;
	currentIndex: number;
	totalAssets: number;
}) {
	return (
		<div className="absolute right-2 bottom-2 left-2 flex items-end justify-between gap-2 rounded-lg bg-background/80 px-3 py-2 backdrop-blur-lg dark:bg-background/60">
			<div className="min-w-0">
				<p className="truncate text-xs">{asset.label}</p>
				<p className="truncate text-[11px] text-muted-foreground">
					{asset.meta}
				</p>
			</div>
			{totalAssets > 1 ? (
				<PreviewCounter currentIndex={currentIndex} totalAssets={totalAssets} />
			) : null}
		</div>
	);
}

export default function PreviewSurface({
	asset,
	currentIndex,
	emptyState,
	isSavedShot,
	isSavingShot,
	onNext,
	onPrevious,
	onSaveShot,
	onSendToWorkflow,
	totalAssets,
}: {
	asset: StudioMediaAsset | null;
	currentIndex: number;
	emptyState?: ReactNode;
	isSavedShot?: boolean;
	isSavingShot?: boolean;
	onNext?: () => void;
	onPrevious?: () => void;
	onSaveShot?: (asset: StudioMediaAsset) => void;
	onSendToWorkflow?: (asset: StudioMediaAsset) => void;
	totalAssets: number;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		function handleFullscreenChange() {
			setIsFullscreen(document.fullscreenElement === containerRef.current);
		}

		document.addEventListener("fullscreenchange", handleFullscreenChange);
		return () => {
			document.removeEventListener("fullscreenchange", handleFullscreenChange);
		};
	}, []);

	useEffect(() => {
		function handleKey(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target?.isContentEditable === true;

			if (isEditableTarget) {
				return;
			}

			if (event.key === "ArrowLeft" && onPrevious) {
				event.preventDefault();
				onPrevious();
			} else if (event.key === "ArrowRight" && onNext) {
				event.preventDefault();
				onNext();
			}
		}

		window.addEventListener("keydown", handleKey);
		return () => {
			window.removeEventListener("keydown", handleKey);
		};
	}, [onNext, onPrevious]);

	async function handleCopyUrl() {
		if (!asset) {
			return;
		}

		try {
			await copyTextToClipboard(asset.url);
			toast.success("URL copied.");
		} catch {
			toast.error("Unable to copy URL.");
		}
	}

	async function handleToggleFullscreen() {
		const node = containerRef.current;

		if (!node) {
			return;
		}

		try {
			if (document.fullscreenElement === node) {
				await document.exitFullscreen();
			} else {
				await node.requestFullscreen();
			}
		} catch {
			toast.error("Fullscreen not available.");
		}
	}

	const isEmpty = !asset;
	const showNavigation = totalAssets > 1;

	return (
		<div
			className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black/5 dark:bg-black/30"
			ref={containerRef}
		>
			{isEmpty ? (
				(emptyState ?? <PreviewEmptyState />)
			) : (
				<>
					<div className="relative flex h-full items-center justify-center overflow-hidden">
						{asset.mediaType === "video" ? (
							<VideoPlayer
								bottomBarExtra={
									showNavigation ? (
										<PreviewCounter
											currentIndex={currentIndex}
											totalAssets={totalAssets}
										/>
									) : null
								}
								key={asset.id}
								label={asset.label}
								meta={asset.meta}
								src={asset.url}
							/>
						) : (
							renderImagePreview(asset)
						)}
					</div>

					{showNavigation ? (
						<PreviewNavigation onNext={onNext} onPrevious={onPrevious} />
					) : null}

					<PreviewBadges asset={asset} />

					<PreviewToolbar
						asset={asset}
						isFullscreen={isFullscreen}
						isSavedShot={isSavedShot}
						isSavingShot={isSavingShot}
						onCopyUrl={handleCopyUrl}
						onSaveShot={onSaveShot}
						onSendToWorkflow={onSendToWorkflow}
						onToggleFullscreen={handleToggleFullscreen}
					/>

					<PreviewProgressOverlay asset={asset} />

					{asset.mediaType === "video" || asset.placeholder === true ? null : (
						<PreviewBottomInfo
							asset={asset}
							currentIndex={currentIndex}
							totalAssets={totalAssets}
						/>
					)}
				</>
			)}
		</div>
	);
}
