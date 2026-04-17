"use client";

import { cn } from "@generator/ui/lib/utils";
import { InfoIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type InfoTooltipProps = {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	label?: string;
} & Pick<ComponentProps<typeof TooltipContent>, "align" | "side">;

export function InfoTooltip({
	align,
	children,
	className,
	contentClassName,
	label = "Show details",
	side,
}: InfoTooltipProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						aria-label={label}
						className={cn(
							"inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							className
						)}
						type="button"
					/>
				}
			>
				<InfoIcon aria-hidden="true" className="size-3.5" />
			</TooltipTrigger>
			<TooltipContent
				align={align}
				className={cn(
					"max-w-sm items-start text-left leading-relaxed",
					contentClassName
				)}
				side={side}
			>
				{children}
			</TooltipContent>
		</Tooltip>
	);
}
