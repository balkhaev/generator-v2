import { cn } from "@generator/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface WorkspaceNavItem {
	current?: boolean;
	href: string;
	icon: LucideIcon;
	label: string;
	shortLabel: string;
}

const statusToneClassNames = {
	danger: "bg-rose-500/8 text-rose-600 dark:text-rose-400",
	info: "bg-sky-500/8 text-sky-600 dark:text-sky-400",
	neutral: "bg-foreground/[0.04] text-muted-foreground",
	success: "bg-emerald-500/8 text-emerald-600 dark:text-emerald-400",
	warning: "bg-amber-500/8 text-amber-600 dark:text-amber-400",
} as const;

export function WorkspaceStatus({
	children,
	className,
	tone = "neutral",
}: {
	children: ReactNode;
	className?: string;
	tone?: keyof typeof statusToneClassNames;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
				statusToneClassNames[tone],
				className
			)}
		>
			{children}
		</span>
	);
}

export function WorkspacePane({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"min-h-0 overflow-hidden rounded-lg border border-foreground/6 bg-background/80 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_4px_16px_-4px_rgb(0_0_0/0.05)] backdrop-blur-xl dark:border-foreground/10 dark:bg-background/60 dark:shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_16px_-4px_rgb(0_0_0/0.18)]",
				className
			)}
		>
			{children}
		</section>
	);
}

export default function WorkspaceShell({
	actions,
	children,
	className,
	context,
	inspector,
	navigation,
	railFooter,
	status,
	subtitle,
	title,
	workspaceLabel,
}: {
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
	context?: ReactNode;
	inspector: ReactNode;
	navigation: WorkspaceNavItem[];
	railFooter?: ReactNode;
	status?: ReactNode;
	subtitle?: ReactNode;
	title: ReactNode;
	workspaceLabel: string;
}) {
	return (
		<main className={cn("grid min-h-svh xl:grid-cols-[3rem_1fr]", className)}>
			<div className="flex items-start gap-2 overflow-x-auto border-foreground/5 px-1 py-3 xl:flex-col xl:items-center xl:gap-1 xl:border-r xl:px-0 xl:py-4 dark:border-foreground/8">
				<nav
					aria-label="Workspace navigation"
					className="flex gap-1 xl:flex-col"
				>
					{navigation.map(({ current, href, icon: Icon, label }) => (
						<a
							aria-current={current ? "page" : undefined}
							className={cn(
								"group flex size-9 items-center justify-center rounded-lg transition-all duration-150 ease-out",
								current
									? "bg-foreground text-background shadow-black/8 shadow-sm"
									: "text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground"
							)}
							href={href}
							key={href}
							title={label}
						>
							<Icon
								aria-hidden="true"
								className="size-[18px]"
								strokeWidth={current ? 2 : 1.5}
							/>
						</a>
					))}
				</nav>

				{railFooter ? (
					<div className="mt-auto hidden px-1 py-1 xl:block">{railFooter}</div>
				) : null}
			</div>

			<div
				className={cn(
					"grid min-h-0 gap-3 p-3 xl:grid-rows-[auto_minmax(0,1fr)]",
					context
						? "xl:grid-cols-[15rem_minmax(0,1fr)_20rem]"
						: "xl:grid-cols-[minmax(0,1fr)_20rem]"
				)}
			>
				<header
					className={cn(
						"flex min-w-0 flex-col gap-2 py-1 lg:flex-row lg:items-center lg:justify-between",
						context ? "xl:col-span-3" : "xl:col-span-2"
					)}
				>
					<div className="min-w-0">
						<div className="flex min-w-0 flex-wrap items-center gap-2.5">
							<span className="text-muted-foreground/50 text-xs">
								{workspaceLabel}
							</span>
							<h1 className="min-w-0 truncate font-medium text-lg tracking-tight">
								{title}
							</h1>
							{status}
						</div>
						{subtitle ? (
							<div className="mt-0.5 min-w-0 text-muted-foreground text-xs">
								{subtitle}
							</div>
						) : null}
					</div>

					{actions ? (
						<div className="flex flex-wrap items-center gap-2">{actions}</div>
					) : null}
				</header>

				{context ? <div className="min-h-0">{context}</div> : null}
				<div className="min-h-0">{children}</div>
				<div className="min-h-0">{inspector}</div>
			</div>
		</main>
	);
}
