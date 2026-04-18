"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import {
	Boxes,
	GraduationCap,
	type LucideIcon,
	PackageOpen,
	Settings,
	Sparkles,
	Tags,
	Workflow,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface AdminSideNavItem {
	description?: string;
	href: Route;
	icon: LucideIcon;
	label: string;
}

const ITEMS: AdminSideNavItem[] = [
	{
		href: "/" as Route,
		icon: Boxes,
		label: "Overview",
		description: "KPIs and recent activity",
	},
	{
		href: "/runs" as Route,
		icon: Workflow,
		label: "Runs",
		description: "Execution stream",
	},
	{
		href: "/scenarios" as Route,
		icon: Sparkles,
		label: "Scenarios",
		description: "Library + last status",
	},
	{
		href: "/training" as Route,
		icon: GraduationCap,
		label: "Training",
		description: "LoRA training jobs",
	},
	{
		href: "/loras" as Route,
		icon: Tags,
		label: "LoRAs",
		description: "Shared registry",
	},
	{
		href: "/releases" as Route,
		icon: PackageOpen,
		label: "Releases",
		description: "S3 rollouts",
	},
	{
		href: "/settings" as Route,
		icon: Settings,
		label: "Settings",
		description: "Inference & runtime",
	},
];

function isActive(href: string, pathname: string) {
	if (href === "/") {
		return pathname === "/";
	}
	return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminSideNav() {
	const pathname = usePathname() ?? "/";

	return (
		<nav
			aria-label="Admin sections"
			className="grid h-full min-h-0 content-start gap-1 overflow-y-auto rounded-lg border border-foreground/6 bg-background/80 px-2 py-2 backdrop-blur-xl dark:border-foreground/10 dark:bg-background/60"
		>
			{ITEMS.map((item) => {
				const active = isActive(item.href, pathname);
				const Icon = item.icon;
				const linkClassName = cn(
					"group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md px-2.5 py-2 transition-colors",
					active
						? "bg-foreground/8 text-foreground"
						: "text-muted-foreground hover:bg-foreground/4 hover:text-foreground"
				);
				const linkContent = (
					<>
						<span
							className={cn(
								"flex size-8 items-center justify-center rounded-md",
								active
									? "bg-foreground text-background"
									: "bg-muted/40 text-muted-foreground group-hover:bg-muted/60 dark:bg-muted/15"
							)}
						>
							<Icon
								aria-hidden="true"
								className="size-4"
								strokeWidth={active ? 2 : 1.5}
							/>
						</span>
						<span className="truncate font-medium text-sm leading-tight">
							{item.label}
						</span>
					</>
				);

				if (!item.description) {
					return (
						<Link
							aria-current={active ? "page" : undefined}
							className={linkClassName}
							href={item.href}
							key={item.href}
						>
							{linkContent}
						</Link>
					);
				}

				return (
					<Tooltip key={item.href}>
						<TooltipTrigger
							render={
								<Link
									aria-current={active ? "page" : undefined}
									className={linkClassName}
									href={item.href}
								/>
							}
						>
							{linkContent}
						</TooltipTrigger>
						<TooltipContent side="right">{item.description}</TooltipContent>
					</Tooltip>
				);
			})}
		</nav>
	);
}
