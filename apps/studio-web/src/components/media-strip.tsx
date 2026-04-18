"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import { Film } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import type { StudioMediaAsset } from "./preview-surface";

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
										className="flex-1 bg-center bg-cover"
										style={{ backgroundImage: `url("${asset.url}")` }}
									/>
								)}
								<div
									className={cn(
										"flex items-center justify-between gap-1 px-1 py-0.5 text-[9px]",
										asset.mediaKind === "output"
											? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
											: "bg-sky-500/15 text-sky-700 dark:text-sky-300"
									)}
								>
									<span className="truncate font-medium uppercase tracking-wide">
										{asset.mediaKind === "output" ? "out" : "in"}
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
