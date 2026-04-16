import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import ScenariosContent from "@/components/scenarios-content";
import { getAdminDashboardSnapshot } from "@/lib/admin-dashboard";
import { getModuleUrls, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
	const { requestHeaders } = await requireSession();
	const { studioUrl } = getModuleUrls();
	const snapshot = await getAdminDashboardSnapshot(requestHeaders);

	return (
		<AdminShell
			subtitle="Scenarios curated for Studio with their last execution state."
			title="Scenarios"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<ScenariosContent initialSnapshot={snapshot} studioUrl={studioUrl} />
			</WorkspacePane>
		</AdminShell>
	);
}
