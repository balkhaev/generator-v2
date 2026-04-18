import WorkspaceShell, {
	WorkspacePane,
} from "@generator/ui/components/workspace-shell";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import type { ReactNode } from "react";

import AdminSideNav from "@/components/admin-side-nav";
import WorkspaceActions from "@/components/workspace-actions";
import { getModuleUrls } from "@/lib/session";

export default function AdminShell({
	actions,
	children,
	inspector,
	status,
	subtitle,
	title,
}: {
	actions?: ReactNode;
	children: ReactNode;
	inspector?: ReactNode;
	status?: ReactNode;
	subtitle?: ReactNode;
	title: ReactNode;
}) {
	const { personsUrl, studioUrl } = getModuleUrls();
	const navigation = createWorkspaceNavigation("admin", {
		admin: "/",
		persons: personsUrl,
		shots: `${studioUrl}/shots`,
		studio: studioUrl,
	});

	return (
		<WorkspaceShell
			actions={actions ?? <WorkspaceActions />}
			context={<AdminSideNav />}
			inspector={
				inspector ?? <WorkspacePane className="h-full">&nbsp;</WorkspacePane>
			}
			navigation={navigation}
			status={status}
			subtitle={subtitle}
			title={title}
			workspaceLabel="Generator admin"
		>
			{children}
		</WorkspaceShell>
	);
}
