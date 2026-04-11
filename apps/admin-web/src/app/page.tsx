import { authClient } from "@generator/auth-client";
import { SectionLabel } from "@generator/ui/components/section-label";
import WorkspaceShell, {
	WorkspacePane,
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { formatRelativeTime } from "@generator/ui/lib/format";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AdminDashboard from "@/components/admin-dashboard";
import AdminInspector from "@/components/admin-inspector";
import WorkspaceActions from "@/components/workspace-actions";
import { getAdminDashboardSnapshot } from "@/lib/admin-dashboard";

export const dynamic = "force-dynamic";

type Snapshot = Awaited<ReturnType<typeof getAdminDashboardSnapshot>>;

function ControlRoomContext({
	personsUrl,
	snapshot,
	studioUrl,
}: {
	personsUrl: string;
	snapshot: Snapshot;
	studioUrl: string;
}) {
	return (
		<div className="grid h-full min-h-0 gap-4 xl:grid-rows-[auto_minmax(0,1fr)]">
			<WorkspacePane>
				<div className="grid gap-4 px-4 py-4">
					<div className="grid gap-3">
						<SectionLabel>Module routes</SectionLabel>
						<a
							className="rounded-lg bg-muted/20 px-3 py-3 text-sm transition hover:bg-muted/35 dark:bg-muted/10 dark:hover:bg-muted/20"
							href={studioUrl}
						>
							<div className="flex items-center justify-between gap-3">
								<span>Studio</span>
								<span className="text-muted-foreground text-xs">
									{snapshot.scenarios.length} scenarios
								</span>
							</div>
						</a>
						<a
							className="rounded-lg bg-muted/20 px-3 py-3 text-sm transition hover:bg-muted/35 dark:bg-muted/10 dark:hover:bg-muted/20"
							href={personsUrl}
						>
							<div className="flex items-center justify-between gap-3">
								<span>Persons</span>
								<span className="text-muted-foreground text-xs">
									cast workspace
								</span>
							</div>
						</a>
					</div>

					{snapshot.notices.length > 0 ? (
						<div className="grid gap-1 rounded-lg bg-amber-500/8 px-4 py-3 text-muted-foreground text-xs dark:bg-amber-500/5">
							<SectionLabel>Notices</SectionLabel>
							{snapshot.notices.slice(0, 3).map((notice) => (
								<p key={notice}>{notice}</p>
							))}
						</div>
					) : null}
				</div>
			</WorkspacePane>

			<WorkspacePane className="flex min-h-0 flex-col">
				<div className="border-foreground/6 border-b px-4 py-3 dark:border-foreground/10">
					<SectionLabel>Watch list</SectionLabel>
				</div>
				<div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-4">
					<div className="grid gap-1">
						<p className="text-muted-foreground text-xs">Recent scenarios</p>
						{snapshot.scenarios.slice(0, 6).map((scenario) => (
							<a
								className="grid gap-1 rounded-lg px-3 py-2.5 transition hover:bg-muted/30"
								href={`${studioUrl}?scenario=${encodeURIComponent(scenario.id)}`}
								key={scenario.id}
							>
								<div className="flex items-center justify-between gap-2">
									<p className="truncate text-sm">{scenario.name}</p>
									<span className="text-muted-foreground text-xs">
										{scenario.lastRunStatus ?? "draft"}
									</span>
								</div>
								<p className="truncate text-muted-foreground text-xs">
									{scenario.workflowKey}
								</p>
							</a>
						))}
					</div>
				</div>
			</WorkspacePane>
		</div>
	);
}

export default async function Home() {
	const requestHeaders = await headers();
	const studioUrl =
		process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3002";
	const personsUrl =
		process.env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";

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

		const snapshot = await getAdminDashboardSnapshot(requestHeaders);

		return (
			<WorkspaceShell
				actions={<WorkspaceActions />}
				context={
					<ControlRoomContext
						personsUrl={personsUrl}
						snapshot={snapshot}
						studioUrl={studioUrl}
					/>
				}
				inspector={<AdminInspector />}
				navigation={createWorkspaceNavigation("admin", {
					admin: "/",
					persons: personsUrl,
					studio: studioUrl,
				})}
				status={
					<WorkspaceStatus
						tone={snapshot.runStatus.failed > 0 ? "warning" : "success"}
					>
						{snapshot.runStatus.failed} failed
					</WorkspaceStatus>
				}
				subtitle={`Signed in as ${session.user.name}. Updated ${formatRelativeTime(snapshot.snapshotAt)}.`}
				title="Control Room"
				workspaceLabel="Generator admin"
			>
				<WorkspacePane className="h-full overflow-y-auto">
					<div className="px-4 py-4">
						<AdminDashboard snapshot={snapshot} />
					</div>
				</WorkspacePane>
			</WorkspaceShell>
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
			<WorkspaceShell
				context={
					<WorkspacePane className="h-full">
						<div className="grid gap-4 px-4 py-4">
							<SectionLabel>Module routes</SectionLabel>
							<a
								className="rounded-lg bg-muted/20 px-3 py-3 text-sm transition hover:bg-muted/35 dark:bg-muted/10 dark:hover:bg-muted/20"
								href={studioUrl}
							>
								Open Studio
							</a>
							<a
								className="rounded-lg bg-muted/20 px-3 py-3 text-sm transition hover:bg-muted/35 dark:bg-muted/10 dark:hover:bg-muted/20"
								href={personsUrl}
							>
								Open Persons
							</a>
						</div>
					</WorkspacePane>
				}
				inspector={
					<WorkspacePane className="h-full">
						<div className="grid gap-2 px-4 py-4 text-sm">
							<SectionLabel>Gateway</SectionLabel>
							<p className="text-muted-foreground">
								Admin gateway is unavailable at{" "}
								<code>
									{process.env.NEXT_PUBLIC_SERVER_URL ??
										"http://localhost:3000"}
								</code>
							</p>
						</div>
					</WorkspacePane>
				}
				navigation={createWorkspaceNavigation("admin", {
					admin: "/",
					persons: personsUrl,
					studio: studioUrl,
				})}
				status={
					<WorkspaceStatus tone="warning">backend unavailable</WorkspaceStatus>
				}
				subtitle={
					error instanceof Error
						? error.message
						: "Unable to reach admin gateway."
				}
				title="Control Room"
				workspaceLabel="Generator admin"
			>
				<WorkspacePane className="h-full">
					<div className="grid gap-4 px-4 py-4">
						<SectionLabel>Control room unavailable</SectionLabel>
						<p className="max-w-xl text-muted-foreground text-sm">
							The shell still loads, but live admin data cannot be fetched until
							the admin gateway and auth endpoint are back online.
						</p>
					</div>
				</WorkspacePane>
			</WorkspaceShell>
		);
	}
}
