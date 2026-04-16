import { cn } from "@generator/ui/lib/utils";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export interface DataListColumn<TRow> {
	align?: "left" | "right";
	header: ReactNode;
	hideOnMobile?: boolean;
	key: string;
	render: (row: TRow) => ReactNode;
	width?: string;
}

export function DataList<TRow>({
	className,
	columns,
	emptyState,
	footer,
	getRowKey,
	isLoading,
	loadingRowsCount = 4,
	onRowClick,
	rows,
}: {
	className?: string;
	columns: DataListColumn<TRow>[];
	emptyState?: ReactNode;
	footer?: ReactNode;
	getRowKey: (row: TRow, index: number) => string;
	isLoading?: boolean;
	loadingRowsCount?: number;
	onRowClick?: (row: TRow) => void;
	rows: TRow[];
}) {
	const gridTemplate = columns
		.map((column) => column.width ?? "minmax(0,1fr)")
		.join(" ");

	if (isLoading) {
		return (
			<div className={cn("grid divide-y divide-foreground/5", className)}>
				<DataListHeader columns={columns} gridTemplate={gridTemplate} />
				{Array.from({ length: loadingRowsCount }, (_, index) => index).map(
					(skeletonIndex) => (
						<div
							className="grid items-center gap-3 px-3 py-3"
							key={`skeleton-${skeletonIndex}`}
							style={{ gridTemplateColumns: gridTemplate }}
						>
							{columns.map((column) => (
								<div
									className={cn(
										"h-4 animate-pulse rounded bg-muted/50 dark:bg-muted/30",
										column.hideOnMobile ? "hidden md:block" : ""
									)}
									key={column.key}
								/>
							))}
						</div>
					)
				)}
				{footer ? (
					<div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
						<Loader2 className="size-3 animate-spin" />
						{footer}
					</div>
				) : null}
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className={cn("grid", className)}>
				<DataListHeader columns={columns} gridTemplate={gridTemplate} />
				<div className="px-3 py-6">{emptyState}</div>
				{footer ? (
					<div className="border-foreground/5 border-t px-3 py-2 text-muted-foreground text-xs">
						{footer}
					</div>
				) : null}
			</div>
		);
	}

	return (
		<div className={cn("grid divide-y divide-foreground/5", className)}>
			<DataListHeader columns={columns} gridTemplate={gridTemplate} />
			{rows.map((row, index) => {
				const isInteractive = Boolean(onRowClick);
				const className2 = cn(
					"grid items-center gap-3 px-3 py-3 text-sm transition-colors",
					isInteractive
						? "cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
						: ""
				);
				if (isInteractive) {
					return (
						<button
							className={cn(className2, "text-left")}
							key={getRowKey(row, index)}
							onClick={() => onRowClick?.(row)}
							style={{ gridTemplateColumns: gridTemplate }}
							type="button"
						>
							{columns.map((column) => (
								<div
									className={cn(
										"min-w-0",
										column.align === "right" ? "text-right" : "",
										column.hideOnMobile ? "hidden md:block" : ""
									)}
									key={column.key}
								>
									{column.render(row)}
								</div>
							))}
						</button>
					);
				}
				return (
					<div
						className={className2}
						key={getRowKey(row, index)}
						style={{ gridTemplateColumns: gridTemplate }}
					>
						{columns.map((column) => (
							<div
								className={cn(
									"min-w-0",
									column.align === "right" ? "text-right" : "",
									column.hideOnMobile ? "hidden md:block" : ""
								)}
								key={column.key}
							>
								{column.render(row)}
							</div>
						))}
					</div>
				);
			})}
			{footer ? (
				<div className="border-foreground/5 border-t px-3 py-2 text-muted-foreground text-xs">
					{footer}
				</div>
			) : null}
		</div>
	);
}

function DataListHeader<TRow>({
	columns,
	gridTemplate,
}: {
	columns: DataListColumn<TRow>[];
	gridTemplate: string;
}) {
	return (
		<div
			className="grid items-center gap-3 border-foreground/5 border-b px-3 py-2 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]"
			style={{ gridTemplateColumns: gridTemplate }}
		>
			{columns.map((column) => (
				<div
					className={cn(
						"min-w-0 truncate",
						column.align === "right" ? "text-right" : "",
						column.hideOnMobile ? "hidden md:block" : ""
					)}
					key={column.key}
				>
					{column.header}
				</div>
			))}
		</div>
	);
}
