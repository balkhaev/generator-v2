import { cn } from "@generator/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const statusBadgeVariants = cva(
	"inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-[11px]",
	{
		variants: {
			tone: {
				success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
				warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
				danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
				info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
				accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
				neutral: "bg-foreground/[0.06] text-muted-foreground",
				muted: "bg-muted/40 text-muted-foreground",
			},
		},
		defaultVariants: {
			tone: "neutral",
		},
	}
);

export type StatusBadgeTone = NonNullable<
	VariantProps<typeof statusBadgeVariants>["tone"]
>;

export function StatusBadge({
	children,
	className,
	icon: Icon,
	tone,
}: {
	children: ReactNode;
	className?: string;
	icon?: LucideIcon;
	tone?: StatusBadgeTone;
}) {
	return (
		<span className={cn(statusBadgeVariants({ tone }), className)}>
			{Icon ? <Icon aria-hidden="true" className="size-3" /> : null}
			{children}
		</span>
	);
}
