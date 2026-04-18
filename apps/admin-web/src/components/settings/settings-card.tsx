import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { cn } from "@generator/ui/lib/utils";
import type { ReactNode } from "react";

interface SettingsCardProps {
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	description?: ReactNode;
	title: ReactNode;
}

export function SettingsCard({
	action,
	children,
	className,
	description,
	title,
}: SettingsCardProps) {
	return (
		<Card className={cn(className)} size="sm">
			<CardHeader>
				<div className="flex items-start justify-between gap-4">
					<div className="grid gap-1">
						<CardTitle>{title}</CardTitle>
						{description ? (
							<CardDescription>{description}</CardDescription>
						) : null}
					</div>
					{action ? <div className="shrink-0">{action}</div> : null}
				</div>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}

interface SettingsRowProps {
	hint?: ReactNode;
	label: ReactNode;
	value: ReactNode;
}

export function SettingsRow({ hint, label, value }: SettingsRowProps) {
	return (
		<div className="grid grid-cols-[minmax(140px,200px)_minmax(0,1fr)] items-baseline gap-3 border-foreground/5 border-b py-2 last:border-b-0">
			<div className="font-mono text-[10px] text-muted-foreground/80 uppercase tracking-[0.18em]">
				{label}
			</div>
			<div className="grid gap-1">
				<div className="break-all font-mono text-foreground text-xs">
					{value}
				</div>
				{hint ? (
					<div className="text-[11px] text-muted-foreground">{hint}</div>
				) : null}
			</div>
		</div>
	);
}
