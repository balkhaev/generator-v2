"use client";

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
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import IconButton from "./icon-button";

const toolbarLinkClass =
	"inline-flex size-7 items-center justify-center rounded-none text-muted-foreground transition hover:bg-muted hover:text-foreground";

const emptyCaptionTrack = "data:text/vtt;charset=utf-8,WEBVTT";
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
	id: string;
	label: string;
	mediaKind: "input" | "output";
	mediaType: "image" | "video";
	meta: string;
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

function renderAssetPreview(asset: StudioMediaAsset) {
	if (asset.mediaType === "video") {
		return (
			<video
				className="h-full w-full bg-black/90 object-contain"
				controls
				preload="metadata"
				src={asset.url}
			>
				<track
					default
					kind="captions"
					label="Captions unavailable"
					src={emptyCaptionTrack}
					srcLang="en"
				/>
			</video>
		);
	}

	return (
		<div
			aria-label={asset.label}
			className="h-full w-full bg-center bg-contain bg-no-repeat"
			role="img"
			style={{ backgroundImage: `url("${asset.url}")` }}
		/>
	);
}

export default function PreviewSurface({
	asset,
	currentIndex,
	emptyState,
	isSavingShot,
	onNext,
	onPrevious,
	onSaveShot,
	totalAssets,
}: {
	asset: StudioMediaAsset | null;
	currentIndex: number;
	emptyState?: ReactNode;
	isSavingShot?: boolean;
	onNext?: () => void;
	onPrevious?: () => void;
	onSaveShot?: (asset: StudioMediaAsset) => void;
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
				(emptyState ?? (
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
								Upload a source image and queue a run to see results here. Use
								the dock below to compose and launch.
							</p>
						</div>
					</div>
				))
			) : (
				<>
					<div className="relative flex h-full items-center justify-center overflow-hidden">
						{renderAssetPreview(asset)}
					</div>

					{showNavigation ? (
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
					) : null}

					<div className="absolute top-2 left-2 flex items-center gap-1.5">
						<span
							className={cn(
								"rounded-full px-2 py-0.5 text-[11px]",
								asset.mediaKind === "output"
									? "bg-emerald-500/15 text-emerald-50 backdrop-blur-md"
									: "bg-sky-500/15 text-sky-50 backdrop-blur-md"
							)}
						>
							{asset.mediaKind}
						</span>
						<span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-[11px] backdrop-blur-md">
							{asset.mediaType === "video" ? (
								<Film className="size-3" />
							) : (
								<ImageIcon className="size-3" />
							)}
							{asset.mediaType}
						</span>
					</div>

					<div className="absolute top-2 right-2 flex items-center gap-1 rounded-lg bg-background/70 px-1 py-1 backdrop-blur-md">
						{onSaveShot && asset.mediaKind === "output" ? (
							<IconButton
								disabled={isSavingShot}
								hint="Save as shot"
								label="Save as shot"
								onClick={() => onSaveShot(asset)}
							>
								{isSavingShot ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Bookmark className="size-3.5" />
								)}
							</IconButton>
						) : null}
						<IconButton
							hint="Copy URL"
							label="Copy media URL"
							onClick={handleCopyUrl}
						>
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
							onClick={handleToggleFullscreen}
						>
							<Maximize2 className="size-3.5" />
						</IconButton>
					</div>

					<div className="absolute right-2 bottom-2 left-2 flex items-end justify-between gap-2 rounded-lg bg-background/80 px-3 py-2 backdrop-blur-lg dark:bg-background/60">
						<div className="min-w-0">
							<p className="truncate text-xs">{asset.label}</p>
							<p className="truncate text-[11px] text-muted-foreground">
								{asset.meta}
							</p>
						</div>
						{showNavigation ? (
							<span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
								{currentIndex + 1} / {totalAssets}
							</span>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}
