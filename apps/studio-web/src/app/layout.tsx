import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import "../index.css";
import Providers from "@/components/providers";

const spaceGrotesk = Space_Grotesk({
	variable: "--font-space-grotesk",
	subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
	variable: "--font-ibm-plex-mono",
	subsets: ["latin"],
	weight: ["400", "500"],
});

export const metadata: Metadata = {
	title: "Generator Studio",
	description:
		"Studio workspace for image-to-video flows and future media generation lanes.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} min-h-svh bg-background font-sans text-foreground antialiased`}
			>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
