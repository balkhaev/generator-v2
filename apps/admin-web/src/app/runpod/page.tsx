import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import RunpodAdminContent from "@/components/runpod-admin/runpod-admin-content";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RunpodPage() {
	await requireSession();

	return (
		<AdminShell
			subtitle="Pod templates, network volumes, и привязка сценариев к ним. Generator при старте читает enabled templates и регистрирует workflows."
			title="RunPod"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<RunpodAdminContent />
			</WorkspacePane>
		</AdminShell>
	);
}
