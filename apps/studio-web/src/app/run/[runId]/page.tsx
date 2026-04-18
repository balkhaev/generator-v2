import { authClient } from "@generator/auth-client";
import { getStudioRunDebugBundleForRequest } from "@generator/studio-client/server";
import type { Route } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import RunDebugPanels from "@/components/run-debug-panels";

export const dynamic = "force-dynamic";

export default async function StudioRunDebugPage({
	params,
}: {
	params: Promise<{ runId: string }>;
}) {
	const { runId } = await params;
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

		let bundle: Awaited<ReturnType<typeof getStudioRunDebugBundleForRequest>>;
		try {
			bundle = await getStudioRunDebugBundleForRequest(
				gatewayBaseUrl,
				runId,
				requestHeaders
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			if (message === "Run not found") {
				notFound();
			}

			return (
				<main className="flex min-h-svh items-center justify-center p-4">
					<div className="studio-frame grid w-full max-w-2xl gap-4 border p-6">
						<div className="grid gap-2">
							<p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.22em]">
								Run debug unavailable
							</p>
							<h1 className="text-2xl tracking-tight">
								The studio could not load this run&apos;s debug bundle.
							</h1>
							<p className="text-muted-foreground text-sm">
								Check that the gateway and studio-api are running, then try
								again.
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
								Root cause: {message || "Unknown error"}
							</p>
						</div>
					</div>
				</main>
			);
		}

		return (
			<main className="mx-auto min-h-svh max-w-5xl px-4 py-8">
				<p className="mb-4 text-muted-foreground text-xs">
					<Link
						className="text-sky-600 underline-offset-4 hover:underline dark:text-sky-400"
						href={"/" as Route}
					>
						← Back to studio
					</Link>
				</p>
				<div className="mb-6 grid gap-1">
					<h1 className="font-semibold text-2xl tracking-tight">Run debug</h1>
					<p className="text-muted-foreground text-sm">
						Studio run{" "}
						<code className="rounded border px-1 font-mono text-[11px]">
							{runId}
						</code>
						{bundle.run.generatorRunId ? (
							<>
								{" · "}
								Execution{" "}
								<code className="rounded border px-1 font-mono text-[11px]">
									{bundle.run.generatorRunId}
								</code>
							</>
						) : null}
					</p>
				</div>
				<RunDebugPanels bundle={bundle} />
			</main>
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
							Session error
						</p>
						<h1 className="text-2xl tracking-tight">
							Could not verify your session.
						</h1>
						<p className="text-muted-foreground text-sm">
							{error instanceof Error ? error.message : "Unknown error"}
						</p>
					</div>
				</div>
			</main>
		);
	}
}
