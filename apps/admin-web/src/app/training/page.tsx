import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import TrainingContent from "@/components/training-content";
import { getAdminDashboardSnapshot } from "@/lib/admin-dashboard";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
	const { requestHeaders } = await requireSession();
	const snapshot = await getAdminDashboardSnapshot(requestHeaders);

	return (
		<AdminShell
			subtitle="LoRA training jobs across all persons with progress and history."
			title="Training"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<TrainingContent initialSnapshot={snapshot} />
			</WorkspacePane>
		</AdminShell>
	);
}
