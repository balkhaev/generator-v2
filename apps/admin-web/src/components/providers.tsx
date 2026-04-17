"use client";

import { Toaster } from "@generator/ui/components/sonner";
import { TooltipProvider } from "@generator/ui/components/tooltip";

import QueryProvider from "./query-provider";
import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange
			enableSystem
		>
			<QueryProvider>
				<TooltipProvider>{children}</TooltipProvider>
				<Toaster richColors />
			</QueryProvider>
		</ThemeProvider>
	);
}
