"use client";

import { Toaster } from "@generator/ui/components/sonner";

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
				{children}
				<Toaster richColors />
			</QueryProvider>
		</ThemeProvider>
	);
}
