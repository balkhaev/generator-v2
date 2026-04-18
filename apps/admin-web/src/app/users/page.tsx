import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import UsersContent, { UsersInspector } from "@/components/users-content";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
	await requireSession();

	return (
		<AdminShell
			inspector={<UsersInspector />}
			subtitle="Manage operators with access to the admin console."
			title="Users"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<UsersContent />
			</WorkspacePane>
		</AdminShell>
	);
}
