import { cn } from "@generator/ui/lib/utils";
import type { ReactNode } from "react";

export function PageHeader({
	actions,
	className,
	description,
	eyebrow,
	title,
}: {
	actions?: ReactNode;
	className?: string;
	description?: ReactNode;
	eyebrow?: ReactNode;
	title: ReactNode;
}) {
	return (
		<header
			className={cn(
				"flex flex-col gap-3 border-foreground/6 border-b px-4 py-4 lg:flex-row lg:items-start lg:justify-between dark:border-foreground/10",
				className
			)}
		>
			<div className="grid min-w-0 gap-1">
				{eyebrow ? (
					<p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]">
						{eyebrow}
					</p>
				) : null}
				<h2 className="min-w-0 font-medium text-base tracking-tight">
					{title}
				</h2>
				{description ? (
					<p className="max-w-2xl text-muted-foreground text-xs leading-relaxed">
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{actions}
				</div>
			) : null}
		</header>
	);
}
