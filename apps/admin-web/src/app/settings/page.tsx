import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import SettingsContent from "@/components/settings-content";
import { getAdminSettingsSnapshot } from "@/lib/admin-settings";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
	const { requestHeaders } = await requireSession();
	const snapshot = await getAdminSettingsSnapshot(requestHeaders);

	return (
		<AdminShell
			subtitle="Runtime controls for inference pipelines: training, dataset prep, persons defaults, generator runtime."
			title="Settings"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<SettingsContent initialSnapshot={snapshot} />
			</WorkspacePane>
		</AdminShell>
	);
}
