import { WorkspacePane } from "@generator/ui/components/workspace-shell";

import AdminShell from "@/components/admin-shell";
import StorageContent from "@/components/storage-content";
import { requireSession } from "@/lib/session";
import { getStorageOverview } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
	const { requestHeaders } = await requireSession();
	const overview = await getStorageOverview(requestHeaders);

	return (
		<AdminShell
			subtitle="S3 bucket operations for generated assets, LoRA files, datasets, and uploads."
			title="Storage"
		>
			<WorkspacePane className="h-full overflow-hidden">
				<StorageContent initialOverview={overview} />
			</WorkspacePane>
		</AdminShell>
	);
}
