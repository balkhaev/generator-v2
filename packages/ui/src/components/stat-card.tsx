import { cn } from "@generator/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const statCardVariants = cva(
	"grid gap-1.5 rounded-lg border px-4 py-3 transition-colors",
	{
		variants: {
			tone: {
				default: "border-foreground/8 bg-muted/15 dark:bg-muted/8",
				success: "border-emerald-500/15 bg-emerald-500/5 dark:bg-emerald-500/8",
				warning: "border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/8",
				danger: "border-rose-500/20 bg-rose-500/5 dark:bg-rose-500/8",
				info: "border-sky-500/15 bg-sky-500/5 dark:bg-sky-500/8",
			},
		},
		defaultVariants: { tone: "default" },
	}
);

const valueToneClassNames = {
	default: "text-foreground",
	success: "text-emerald-700 dark:text-emerald-300",
	warning: "text-amber-700 dark:text-amber-300",
	danger: "text-rose-700 dark:text-rose-300",
	info: "text-sky-700 dark:text-sky-300",
} as const;

export type StatCardTone = NonNullable<
	VariantProps<typeof statCardVariants>["tone"]
>;

export function StatCard({
	className,
	hint,
	icon: Icon,
	label,
	tone = "default",
	value,
}: {
	className?: string;
	hint?: ReactNode;
	icon?: LucideIcon;
	label: ReactNode;
	tone?: StatCardTone;
	value: ReactNode;
}) {
	return (
		<div className={cn(statCardVariants({ tone }), className)}>
			<div className="flex items-center gap-2">
				{Icon ? (
					<Icon
						aria-hidden="true"
						className={cn("size-3.5", valueToneClassNames[tone])}
						strokeWidth={1.75}
					/>
				) : null}
				<p className="text-muted-foreground text-xs uppercase tracking-wider">
					{label}
				</p>
			</div>
			<p
				className={cn(
					"font-medium text-2xl tabular-nums leading-none tracking-tight",
					valueToneClassNames[tone]
				)}
			>
				{value}
			</p>
			{hint ? (
				<p className="text-[11px] text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
}
