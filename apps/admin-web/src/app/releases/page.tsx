import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import ReleasesContent from "@/components/releases-content";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
	await requireSession();

	return (
		<AdminShell
			subtitle="Upload, provision, and monitor S3 fan-out for runtime assets."
			title="Releases"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<ReleasesContent />
			</WorkspacePane>
		</AdminShell>
	);
}
