import WorkspaceShell from "@generator/ui/components/workspace-shell";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import type { ReactNode } from "react";

import AdminSideNav from "@/components/admin-side-nav";
import WorkspaceActions from "@/components/workspace-actions";
import { getModuleUrls } from "@/lib/session";

/**
 * Admin shell. The right-hand inspector pane is OPT-IN — pages that don't
 * need it omit `inspector` and the layout collapses to a two-column
 * (rail + main) grid. Previously we always rendered an empty `WorkspacePane`
 * placeholder, which wasted ~20rem of horizontal real estate on every page.
 */
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
			{...(inspector ? { inspector } : {})}
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
