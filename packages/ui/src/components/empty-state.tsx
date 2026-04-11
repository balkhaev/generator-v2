import { cn } from "@generator/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
	action,
	className,
	hint,
	icon: Icon,
	message,
}: {
	action?: ReactNode;
	className?: string;
	hint?: string;
	icon?: LucideIcon;
	message: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center gap-3 rounded-sm bg-muted/25 px-6 py-8 text-center dark:bg-muted/10",
				className
			)}
		>
			{Icon ? (
				<Icon className="size-5 text-muted-foreground/50" strokeWidth={1.5} />
			) : null}
			<div className="grid gap-1">
				<p className="text-muted-foreground text-sm">{message}</p>
				{hint ? (
					<p className="text-muted-foreground/60 text-xs">{hint}</p>
				) : null}
			</div>
			{action ?? null}
		</div>
	);
}
