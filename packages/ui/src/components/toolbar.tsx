"use client";

import { cn } from "@generator/ui/lib/utils";
import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./button";

/**
 * Horizontal bar for filters, search and actions above a content surface.
 * Wraps gracefully and pushes trailing items to the right via ToolbarSpacer.
 */
export function Toolbar({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-2 border-foreground/6 border-b px-3 py-2 dark:border-foreground/10",
				className
			)}
			data-slot="toolbar"
		>
			{children}
		</div>
	);
}

export function ToolbarGroup({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center gap-2", className)}>{children}</div>
	);
}

export function ToolbarSpacer() {
	return <div aria-hidden="true" className="ml-auto" />;
}

/**
 * Standardized refresh control. Shows a spinning icon while `isRefreshing`
 * and stays disabled to prevent duplicate requests.
 */
export function RefreshButton({
	className,
	isRefreshing = false,
	label = "Refresh",
	onRefresh,
	size = "sm",
}: {
	className?: string;
	isRefreshing?: boolean;
	label?: string;
	onRefresh: () => void;
	size?: "default" | "sm" | "xs";
}) {
	return (
		<Button
			className={className}
			disabled={isRefreshing}
			onClick={onRefresh}
			size={size}
			type="button"
			variant="outline"
		>
			<RefreshCwIcon className={cn(isRefreshing && "animate-spin")} />
			{label}
		</Button>
	);
}
