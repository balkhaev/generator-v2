import { cn } from "@generator/ui/lib/utils";
import type { ReactNode } from "react";

import { SectionLabel } from "./section-label";

export function PaneHeader({
	actions,
	className,
	description,
	label,
}: {
	actions?: ReactNode;
	className?: string;
	description?: string;
	label: string;
}) {
	return (
		<div
			className={cn(
				"flex items-start justify-between gap-3 border-foreground/6 border-b px-4 py-3 dark:border-foreground/10",
				className
			)}
		>
			<div className="grid min-w-0 gap-1">
				<SectionLabel>{label}</SectionLabel>
				{description ? (
					<p className="text-muted-foreground/80 text-xs leading-relaxed">
						{description}
					</p>
				) : null}
			</div>
			{actions ? <div className="shrink-0">{actions}</div> : null}
		</div>
	);
}
