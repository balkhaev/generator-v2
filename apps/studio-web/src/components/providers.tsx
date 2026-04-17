"use client";

import { Toaster } from "@generator/ui/components/sonner";
import { TooltipProvider } from "@generator/ui/components/tooltip";

import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange
			enableSystem
		>
			<TooltipProvider delay={250}>{children}</TooltipProvider>
			<Toaster richColors />
		</ThemeProvider>
	);
}
