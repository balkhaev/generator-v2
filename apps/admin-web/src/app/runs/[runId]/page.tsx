import { WorkspacePane } from "@generator/ui/components/workspace-shell";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import RunDebugPanels from "@/components/run-debug-panels";
import { getAdminRunDebugBundle } from "@/lib/admin-run-debug";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminRunDebugPage({
	params,
}: {
	params: Promise<{ runId: string }>;
}) {
	const { runId } = await params;
	const { requestHeaders } = await requireSession();

	let bundle: Awaited<ReturnType<typeof getAdminRunDebugBundle>>;
	try {
		bundle = await getAdminRunDebugBundle(runId, requestHeaders);
	} catch {
		notFound();
	}

	return (
		<AdminShell
			subtitle={
				<span className="text-muted-foreground">
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
				</span>
			}
			title="Run debug"
		>
			<WorkspacePane className="h-full min-h-0 overflow-hidden">
				<div className="min-h-0 overflow-y-auto px-4 py-4">
					<p className="mb-4 text-muted-foreground text-xs">
						<Link
							className="text-sky-600 underline-offset-4 hover:underline dark:text-sky-400"
							href={"/runs" as Route}
						>
							← Back to runs
						</Link>
					</p>
					<p className="mb-6 text-muted-foreground text-sm">
						Full JSON from studio-api and generator-api for this run.
					</p>
					<RunDebugPanels bundle={bundle} />
				</div>
			</WorkspacePane>
		</AdminShell>
	);
}
