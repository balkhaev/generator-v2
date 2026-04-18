import { cn } from "@generator/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { WorkspaceAccent } from "../lib/workspace-nav";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export interface WorkspaceNavItem {
	accent?: WorkspaceAccent;
	current?: boolean;
	href: string;
	icon: LucideIcon;
	label: string;
	shortLabel: string;
}

interface WorkspaceNavCssVars extends CSSProperties {
	"--workspace-accent"?: string;
	"--workspace-accent-dark"?: string;
	"--workspace-accent-foreground"?: string;
}

function buildAccentStyle(
	accent: WorkspaceAccent | undefined
): WorkspaceNavCssVars | undefined {
	if (!accent) {
		return;
	}
	const { chroma, foreground, hue, lightness, lightnessDark } = accent;
	return {
		"--workspace-accent": `oklch(${lightness} ${chroma} ${hue})`,
		"--workspace-accent-dark": `oklch(${lightnessDark} ${chroma} ${hue})`,
		"--workspace-accent-foreground": foreground,
	};
}

const navItemBase =
	"group relative flex size-9 items-center justify-center rounded-lg transition-all duration-150 ease-out";

function resolveNavItemClassName({
	current,
	hasAccent,
}: {
	current: boolean;
	hasAccent: boolean;
}) {
	if (current && hasAccent) {
		return cn(
			navItemBase,
			"bg-[var(--workspace-accent)] text-[var(--workspace-accent-foreground)] shadow-[0_4px_18px_-6px_var(--workspace-accent)] dark:bg-[var(--workspace-accent-dark)] dark:shadow-[0_4px_18px_-6px_var(--workspace-accent-dark)]"
		);
	}
	if (current) {
		return cn(
			navItemBase,
			"bg-foreground text-background shadow-black/8 shadow-sm"
		);
	}
	if (hasAccent) {
		return cn(
			navItemBase,
			"text-muted-foreground/70 hover:bg-[color-mix(in_srgb,var(--workspace-accent)_18%,transparent)] hover:text-[var(--workspace-accent)] dark:hover:bg-[color-mix(in_srgb,var(--workspace-accent-dark)_22%,transparent)] dark:hover:text-[var(--workspace-accent-dark)]"
		);
	}
	return cn(
		navItemBase,
		"text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground"
	);
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

export type WorkspaceContextWidth = "narrow" | "wide";

export default function WorkspaceShell({
	actions,
	bottomDock,
	children,
	className,
	context,
	contextWidth = "narrow",
	inspector,
	navigation,
	railFooter,
	status,
	subtitle,
	title,
	workspaceLabel,
}: {
	actions?: ReactNode;
	bottomDock?: ReactNode;
	children: ReactNode;
	className?: string;
	context?: ReactNode;
	contextWidth?: WorkspaceContextWidth;
	inspector?: ReactNode;
	navigation: WorkspaceNavItem[];
	railFooter?: ReactNode;
	status?: ReactNode;
	subtitle?: ReactNode;
	title: ReactNode;
	workspaceLabel: string;
}) {
	const hasInspector = inspector !== undefined && inspector !== null;
	const columnCount = (context ? 1 : 0) + 1 + (hasInspector ? 1 : 0);
	const gridTemplate = (() => {
		if (context && hasInspector) {
			return contextWidth === "wide"
				? "xl:grid-cols-[22rem_minmax(0,1fr)_20rem]"
				: "xl:grid-cols-[15rem_minmax(0,1fr)_20rem]";
		}
		if (context) {
			return contextWidth === "wide"
				? "xl:grid-cols-[22rem_minmax(0,1fr)]"
				: "xl:grid-cols-[14rem_minmax(0,1fr)]";
		}
		if (hasInspector) {
			return "xl:grid-cols-[minmax(0,1fr)_20rem]";
		}
		return "xl:grid-cols-[minmax(0,1fr)]";
	})();
	const headerSpan = (() => {
		if (columnCount === 3) {
			return "xl:col-span-3";
		}
		if (columnCount === 2) {
			return "xl:col-span-2";
		}
		return "xl:col-span-1";
	})();
	return (
		<main
			className={cn(
				"grid min-h-svh xl:h-svh xl:grid-cols-[3rem_1fr] xl:overflow-hidden",
				className
			)}
		>
			<div className="flex min-h-0 items-start gap-2 overflow-x-auto border-foreground/5 px-1 py-3 xl:flex-col xl:items-center xl:gap-1 xl:border-r xl:px-0 xl:py-4 dark:border-foreground/8">
				<nav
					aria-label="Workspace navigation"
					className="flex gap-1 xl:flex-col"
				>
					{navigation.map(({ accent, current, href, icon: Icon, label }) => {
						const accentStyle = buildAccentStyle(accent);
						const hasAccent = accentStyle !== undefined;
						const navItemClassName = resolveNavItemClassName({
							current: Boolean(current),
							hasAccent,
						});
						return (
							<Tooltip key={href}>
								<TooltipTrigger
									render={
										<a
											aria-current={current ? "page" : undefined}
											aria-label={label}
											className={navItemClassName}
											href={href}
											style={accentStyle}
										>
											<Icon
												aria-hidden="true"
												className="size-[18px]"
												strokeWidth={current ? 2 : 1.5}
											/>
											{hasAccent && !current ? (
												<span
													aria-hidden="true"
													className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[var(--workspace-accent)] opacity-60 transition-opacity duration-150 group-hover:opacity-100 dark:bg-[var(--workspace-accent-dark)]"
												/>
											) : null}
											<span className="sr-only">{label}</span>
										</a>
									}
								/>
								<TooltipContent side="right">{label}</TooltipContent>
							</Tooltip>
						);
					})}
				</nav>

				{railFooter ? (
					<div className="mt-auto hidden px-1 py-1 xl:block">{railFooter}</div>
				) : null}
			</div>

			<div
				className={cn(
					"grid min-h-0 gap-3 p-3 xl:grid-rows-[auto_minmax(0,1fr)] xl:overflow-hidden",
					gridTemplate
				)}
			>
				<header
					className={cn(
						"flex min-w-0 flex-col gap-2 py-1 lg:flex-row lg:items-center lg:justify-between",
						headerSpan
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
				<div className="flex min-h-0 flex-col gap-3">
					<div className="min-h-0 flex-1">{children}</div>
					{bottomDock ? (
						<div className="min-h-0 shrink-0">{bottomDock}</div>
					) : null}
				</div>
				{hasInspector ? <div className="min-h-0">{inspector}</div> : null}
			</div>
		</main>
	);
}
