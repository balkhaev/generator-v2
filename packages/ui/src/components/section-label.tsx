import { cn } from "@generator/ui/lib/utils";
import type { ReactNode } from "react";

export function SectionLabel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<p
			className={cn(
				"font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]",
				className
			)}
		>
			{children}
		</p>
	);
}
