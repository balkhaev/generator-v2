import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import WorkflowsContent from "@/components/workflows-content";
import { getAdminWorkflows } from "@/lib/admin-workflows";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
	const { requestHeaders } = await requireSession();
	const workflows = await getAdminWorkflows(requestHeaders);

	return (
		<AdminShell
			subtitle="Workflow registry visibility for Studio."
			title="Workflows"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<WorkflowsContent initialData={workflows} />
			</WorkspacePane>
		</AdminShell>
	);
}
