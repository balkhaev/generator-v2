import WorkspaceShell, {
	WorkspacePane,
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";

import AdminShell from "@/components/admin-shell";
import OverviewContent from "@/components/overview-content";
import WorkspaceActions from "@/components/workspace-actions";
import { getAdminDashboardSnapshot } from "@/lib/admin-dashboard";
import { getModuleUrls, requireSession } from "@/lib/session";
import {
	getDisplayTrainingStatus,
	isActiveTrainingStatus,
} from "@/lib/training";

export const dynamic = "force-dynamic";

export default async function Home() {
	const { requestHeaders } = await requireSession();
	const { personsUrl, studioUrl } = getModuleUrls();

	try {
		const snapshot = await getAdminDashboardSnapshot(requestHeaders);
		const failedCount = snapshot.runStatus.failed;
		const activeTrainings = snapshot.loraTrainings.filter((item) => {
			const status = getDisplayTrainingStatus(
				item.training,
				Boolean(item.loraUrl)
			);
			return isActiveTrainingStatus(status);
		}).length;

		return (
			<AdminShell
				status={
					<WorkspaceStatus tone={failedCount > 0 ? "warning" : "success"}>
						{failedCount} failed · {activeTrainings} training
					</WorkspaceStatus>
				}
				subtitle="Generator control room and module entrypoints."
				title="Overview"
			>
				<WorkspacePane className="h-full overflow-hidden">
					<OverviewContent
						initialSnapshot={snapshot}
						personsUrl={personsUrl}
						studioUrl={studioUrl}
					/>
				</WorkspacePane>
			</AdminShell>
		);
	} catch (error) {
		const navigation = createWorkspaceNavigation("admin", {
			admin: "/",
			persons: personsUrl,
			shots: `${studioUrl}/shots`,
			studio: studioUrl,
		});

		return (
			<WorkspaceShell
				actions={<WorkspaceActions />}
				navigation={navigation}
				status={
					<WorkspaceStatus tone="warning">backend unavailable</WorkspaceStatus>
				}
				subtitle={
					error instanceof Error
						? error.message
						: "Unable to reach admin gateway."
				}
				title="Overview"
				workspaceLabel="Generator admin"
			>
				<WorkspacePane className="h-full">
					<div className="grid gap-4 px-4 py-4">
						<p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]">
							Control room unavailable
						</p>
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
