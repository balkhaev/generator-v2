"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@generator/ui/lib/utils";
import { SearchIcon, XIcon } from "lucide-react";
import type * as React from "react";

export function SearchInput({
	className,
	onClear,
	onValueChange,
	value,
	...props
}: Omit<React.ComponentProps<"input">, "onChange" | "value"> & {
	onClear?: () => void;
	onValueChange?: (value: string) => void;
	value?: string;
}) {
	const stringValue = typeof value === "string" ? value : "";
	const showClear = stringValue.length > 0;

	const handleClear = () => {
		onValueChange?.("");
		onClear?.();
	};

	return (
		<div
			className={cn(
				"group relative flex h-8 w-full min-w-0 items-center rounded-none border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 dark:bg-input/30",
				className
			)}
			data-slot="search-input"
		>
			<SearchIcon
				aria-hidden="true"
				className="pointer-events-none ml-2.5 size-3.5 shrink-0 text-muted-foreground/70"
			/>
			<InputPrimitive
				className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
				onChange={(event) => onValueChange?.(event.target.value)}
				type="search"
				value={stringValue}
				{...props}
			/>
			{showClear ? (
				<button
					aria-label="Clear search"
					className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-none text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
					onClick={handleClear}
					type="button"
				>
					<XIcon className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}
