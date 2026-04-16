import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import RunsContent from "@/components/runs-content";
import { getAdminDashboardSnapshot } from "@/lib/admin-dashboard";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
	const { requestHeaders } = await requireSession();
	const snapshot = await getAdminDashboardSnapshot(requestHeaders);

	return (
		<AdminShell
			subtitle="Live execution stream from the generator pipeline."
			title="Runs"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<RunsContent initialSnapshot={snapshot} />
			</WorkspacePane>
		</AdminShell>
	);
}
