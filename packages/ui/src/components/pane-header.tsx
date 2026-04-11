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
				"flex items-center justify-between gap-3 border-foreground/6 border-b px-4 py-3 dark:border-foreground/10",
				className
			)}
		>
			<div className="grid gap-0.5">
				<SectionLabel>{label}</SectionLabel>
				{description ? (
					<p className="text-muted-foreground text-xs">{description}</p>
				) : null}
			</div>
			{actions ?? null}
		</div>
	);
}
