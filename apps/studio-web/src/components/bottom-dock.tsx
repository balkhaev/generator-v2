"use client";

import { cn } from "@generator/ui/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useState } from "react";

interface BottomDockProps {
	children: ReactNode;
	className?: string;
	defaultOpen?: boolean;
	hint?: string;
	title: string;
}

export default function BottomDock({
	children,
	className,
	defaultOpen = true,
	hint,
	title,
}: BottomDockProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<section
			className={cn(
				"studio-surface flex min-h-0 flex-col overflow-hidden",
				className
			)}
		>
			<button
				className="flex items-center justify-between gap-2 border-foreground/6 border-b px-3 py-1.5 text-left transition hover:bg-muted/10 dark:border-foreground/10"
				onClick={() => setIsOpen((value) => !value)}
				type="button"
			>
				<div className="flex min-w-0 items-center gap-2">
					<span className="text-[11px] text-muted-foreground uppercase tracking-wide">
						{title}
					</span>
					{hint ? (
						<span className="truncate text-[11px] text-muted-foreground/80">
							{hint}
						</span>
					) : null}
				</div>
				<span
					aria-hidden="true"
					className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground"
				>
					{isOpen ? (
						<ChevronDown className="size-3.5" />
					) : (
						<ChevronUp className="size-3.5" />
					)}
				</span>
			</button>
			{isOpen ? (
				<div className="max-h-[42vh] min-h-0 flex-1 overflow-hidden">
					{children}
				</div>
			) : null}
		</section>
	);
}
