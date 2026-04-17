"use client";

import { Button } from "@generator/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@generator/ui/components/dropdown-menu";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ModeToggle() {
	const { setTheme, theme } = useTheme();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button aria-label="Toggle theme" size="icon-sm" variant="outline" />
				}
			>
				<Sun className="size-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
				<Moon className="absolute size-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
				<span className="sr-only">Toggle theme</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => setTheme("light")}>
					<Sun className="size-3.5" />
					Light
					{theme === "light" ? (
						<span className="ml-auto text-[10px] text-muted-foreground">●</span>
					) : null}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("dark")}>
					<Moon className="size-3.5" />
					Dark
					{theme === "dark" ? (
						<span className="ml-auto text-[10px] text-muted-foreground">●</span>
					) : null}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("system")}>
					<Monitor className="size-3.5" />
					System
					{theme === "system" ? (
						<span className="ml-auto text-[10px] text-muted-foreground">●</span>
					) : null}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
