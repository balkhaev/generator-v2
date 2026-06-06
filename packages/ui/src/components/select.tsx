"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@generator/ui/lib/utils";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

function Select<Value, Multiple extends boolean | undefined = false>(
	props: SelectPrimitive.Root.Props<Value, Multiple>
) {
	return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(props: SelectPrimitive.Value.Props) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	children,
	className,
	size = "default",
	...props
}: SelectPrimitive.Trigger.Props & {
	size?: "default" | "sm";
}) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				"flex w-full min-w-0 select-none items-center justify-between gap-2 whitespace-nowrap rounded-none border border-input bg-transparent px-2.5 py-1 text-xs outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				size === "sm" ? "h-7" : "h-8",
				className
			)}
			data-size={size}
			data-slot="select-trigger"
			{...props}
		>
			<span className="min-w-0 truncate text-left">{children}</span>
			<SelectPrimitive.Icon className="text-muted-foreground/70">
				<ChevronsUpDownIcon />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	align = "start",
	children,
	className,
	side = "bottom",
	sideOffset = 4,
	...props
}: SelectPrimitive.Popup.Props &
	Pick<SelectPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				align={align}
				alignItemWithTrigger={false}
				className="isolate z-50 outline-none"
				side={side}
				sideOffset={sideOffset}
			>
				<SelectPrimitive.Popup
					className={cn(
						"data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-none bg-popover p-0.5 text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in",
						className
					)}
					data-slot="select-content"
					{...props}
				>
					{children}
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectGroupLabel({
	className,
	...props
}: SelectPrimitive.GroupLabel.Props) {
	return (
		<SelectPrimitive.GroupLabel
			className={cn(
				"px-2 py-1.5 font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]",
				className
			)}
			data-slot="select-group-label"
			{...props}
		/>
	);
}

function SelectItem({
	children,
	className,
	...props
}: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			className={cn(
				"relative flex w-full cursor-default select-none items-center gap-2 rounded-none py-1.5 pr-8 pl-2 text-xs outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className
			)}
			data-slot="select-item"
			{...props}
		>
			<SelectPrimitive.ItemText className="min-w-0 truncate">
				{children}
			</SelectPrimitive.ItemText>
			<span className="pointer-events-none absolute right-2 flex items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<CheckIcon className="size-3.5" />
				</SelectPrimitive.ItemIndicator>
			</span>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({
	className,
	...props
}: SelectPrimitive.Separator.Props) {
	return (
		<SelectPrimitive.Separator
			className={cn("-mx-0.5 my-1 h-px bg-border", className)}
			data-slot="select-separator"
			{...props}
		/>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectGroupLabel,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
