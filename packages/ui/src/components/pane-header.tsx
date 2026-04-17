import { cn } from "@generator/ui/lib/utils";
import type { ReactNode } from "react";

import { InfoTooltip } from "./info-tooltip";
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
			<div className="flex min-w-0 items-center gap-1.5">
				<SectionLabel>{label}</SectionLabel>
				{description ? (
					<InfoTooltip label="Show section details" side="bottom">
						{description}
					</InfoTooltip>
				) : null}
			</div>
			{actions ?? null}
		</div>
	);
}
