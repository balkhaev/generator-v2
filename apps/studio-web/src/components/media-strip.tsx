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
									<div className="flex flex-1 items-center justify-center bg-black/80">
										<Film
											aria-hidden="true"
											className="size-5 text-white/70"
											strokeWidth={1.5}
										/>
									</div>
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
