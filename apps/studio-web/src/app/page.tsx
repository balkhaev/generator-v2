import { authClient } from "@generator/auth-client";
import { getStudioSnapshotForRequest } from "@generator/studio-client/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import StudioShell from "@/components/studio-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
	const requestHeaders = await headers();
	const gatewayBaseUrl =
		process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3006";

	try {
		const session = await authClient.getSession({
			fetchOptions: {
				headers: requestHeaders,
				throw: true,
			},
		});

		if (!session?.user) {
			redirect("/login");
		}

		const snapshot = await getStudioSnapshotForRequest(
			gatewayBaseUrl,
			requestHeaders
		);

		return (
			<StudioShell initialSnapshot={snapshot} sessionName={session.user.name} />
		);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"digest" in error &&
			typeof error.digest === "string" &&
			error.digest.startsWith("NEXT_REDIRECT")
		) {
			throw error;
		}

		return (
			<main className="flex min-h-svh items-center justify-center p-4">
				<div className="studio-frame grid w-full max-w-2xl gap-4 border p-6">
					<div className="grid gap-2">
						<p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.22em]">
							Studio backend unavailable
						</p>
						<h1 className="text-2xl tracking-tight">
							The studio could not reach the real studio backend.
						</h1>
						<p className="text-muted-foreground text-sm">
							To run the studio on real rails, start the studio backend and the
							generator backend, then reload this page.
						</p>
					</div>
					<div className="grid gap-2 border border-foreground/8 bg-background/45 p-3 text-sm">
						<p>
							Gateway URL:
							<code className="ml-2 border px-1.5 py-0.5 font-mono text-[11px]">
								{gatewayBaseUrl}
							</code>
						</p>
						<p className="text-muted-foreground text-xs">
							Root cause:{" "}
							{error instanceof Error ? error.message : "Unknown error"}
						</p>
					</div>
				</div>
			</main>
		);
	}
}
