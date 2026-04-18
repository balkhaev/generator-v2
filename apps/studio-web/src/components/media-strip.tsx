"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import { Film, Loader2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { StudioMediaAsset } from "./preview-surface";

function formatPlaceholderLabel(asset: StudioMediaAsset) {
	if (asset.status === "queued") {
		return "queue";
	}
	if (
		typeof asset.progressPct === "number" &&
		Number.isFinite(asset.progressPct)
	) {
		return `${Math.round(asset.progressPct)}%`;
	}
	return "gen";
}

// `#t=0.1` подсказывает браузеру стартовать с 0.1с вместо нуля, что в большинстве
// движков рендерится как первый осмысленный кадр (нулевой иногда чёрный из-за
// фейда). Если video не поддерживается / не подгрузится, останется poster.
function buildVideoThumbnailSrc(url: string) {
	return url.includes("#") ? url : `${url}#t=0.1`;
}

function VideoThumbnail({ asset }: { asset: StudioMediaAsset }) {
	const posterUrl = asset.posterUrl ?? null;

	return (
		<div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black/80">
			{posterUrl ? (
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-center bg-cover"
					style={{ backgroundImage: `url("${posterUrl}")` }}
				/>
			) : null}
			<video
				aria-hidden="true"
				className="relative h-full w-full object-cover"
				disablePictureInPicture
				muted
				playsInline
				poster={posterUrl ?? undefined}
				preload="metadata"
				src={buildVideoThumbnailSrc(asset.url)}
				tabIndex={-1}
			>
				<track kind="captions" />
			</video>
			<span
				aria-hidden="true"
				className="absolute right-1 bottom-1 inline-flex size-5 items-center justify-center rounded-full bg-black/60 text-white/90"
			>
				<Film className="size-3" strokeWidth={1.75} />
			</span>
		</div>
	);
}

export default function MediaStrip({
	assets,
	getHref,
	selectedMediaId,
}: {
	assets: StudioMediaAsset[];
	getHref: (mediaId: string) => Route;
	selectedMediaId: string | null;
}) {
	if (assets.length === 0) {
		return null;
	}

	return (
		<div className="rounded-xl bg-foreground/[0.03] px-2 py-2 dark:bg-foreground/[0.05]">
			<div className="flex gap-2 overflow-x-auto py-0.5">
				{assets.map((asset) => {
					const isActive = asset.id === selectedMediaId;
					const isVideo = asset.mediaType === "video";
					const isPlaceholder = asset.placeholder === true;

					return (
						<Tooltip key={asset.id}>
							<TooltipTrigger
								render={
									<Link
										aria-current={isActive ? "true" : undefined}
										aria-label={asset.label}
										className={cn(
											"group relative flex aspect-[9/16] h-24 shrink-0 flex-col items-stretch overflow-hidden rounded-lg transition",
											isActive
												? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
												: "ring-1 ring-foreground/[0.06] hover:ring-foreground/30 dark:ring-foreground/[0.1]"
										)}
										href={getHref(asset.id)}
										scroll={false}
									/>
								}
							>
								{isVideo ? (
									<VideoThumbnail asset={asset} />
								) : (
									<div
										aria-hidden="true"
										className={cn(
											"flex-1 bg-center bg-cover",
											isPlaceholder && "opacity-70 saturate-50"
										)}
										style={{ backgroundImage: `url("${asset.url}")` }}
									/>
								)}
								{isPlaceholder ? (
									<div
										aria-hidden="true"
										className="absolute inset-0 flex items-center justify-center bg-background/30 backdrop-blur-[1px]"
									>
										<Loader2 className="size-4 animate-spin text-foreground/80" />
									</div>
								) : null}
								<div
									className={cn(
										"flex items-center justify-between gap-1 px-1 py-0.5 text-[9px]",
										isPlaceholder
											? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
											: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
									)}
								>
									<span className="truncate font-medium uppercase tracking-wide">
										{isPlaceholder ? formatPlaceholderLabel(asset) : "out"}
									</span>
									{isVideo ? <span>video</span> : null}
								</div>
							</TooltipTrigger>
							<TooltipContent>{asset.label}</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</div>
	);
}
