"use client";

import { Button } from "@generator/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import type { ComponentProps, ReactNode } from "react";

type IconButtonProps = ComponentProps<typeof Button> & {
	hint?: ReactNode;
	hintSide?: "top" | "bottom" | "left" | "right";
	label: string;
};

export default function IconButton({
	children,
	hint,
	hintSide = "top",
	label,
	size = "icon-sm",
	variant = "ghost",
	...rest
}: IconButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button aria-label={label} size={size} variant={variant} {...rest} />
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent side={hintSide}>{hint ?? label}</TooltipContent>
		</Tooltip>
	);
}
