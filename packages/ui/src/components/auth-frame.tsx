import { cn } from "@generator/ui/lib/utils";
import type { ReactNode } from "react";

export default function AuthFrame({
	children,
	className,
	label,
	subtitle,
	title,
}: {
	children: ReactNode;
	className?: string;
	label?: string;
	subtitle?: string;
	title: string;
}) {
	return (
		<div
			className={cn(
				"mx-auto grid w-full max-w-md gap-6 border border-foreground/6 bg-background/80 p-8 shadow-[0_2px_4px_rgb(0_0_0/0.02),0_12px_40px_-8px_rgb(0_0_0/0.08)] backdrop-blur-xl dark:border-foreground/10 dark:bg-background/60 dark:shadow-[0_2px_4px_rgb(0_0_0/0.15),0_12px_40px_-8px_rgb(0_0_0/0.3)]",
				className
			)}
		>
			<div className="grid gap-2">
				{label ? (
					<p className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.22em]">
						{label}
					</p>
				) : null}
				<h1 className="font-medium text-2xl tracking-tight">{title}</h1>
				{subtitle ? (
					<p className="text-muted-foreground text-sm leading-relaxed">
						{subtitle}
					</p>
				) : null}
			</div>
			{children}
		</div>
	);
}
