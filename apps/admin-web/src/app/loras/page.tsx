import { authClient } from "@generator/auth-client";
import WorkspaceShell, {
	WorkspacePane,
} from "@generator/ui/components/workspace-shell";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import LorasConsole from "@/components/loras-console";

export const dynamic = "force-dynamic";

export default async function LorasPage() {
	const requestHeaders = await headers();
	const studioUrl =
		process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3002";
	const personsUrl =
		process.env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";

	const session = await authClient.getSession({
		fetchOptions: {
			headers: requestHeaders,
			throw: true,
		},
	});

	if (!session?.user) {
		redirect("/login");
	}

	return (
		<WorkspaceShell
			inspector={<WorkspacePane className="h-full">&nbsp;</WorkspacePane>}
			navigation={createWorkspaceNavigation("admin", {
				admin: "/",
				persons: personsUrl,
				studio: studioUrl,
			})}
			subtitle="Shared LoRA registry used by Studio and Persons."
			title="LoRAs"
			workspaceLabel="Generator admin"
		>
			<WorkspacePane className="h-full overflow-y-auto">
				<div className="px-4 py-4">
					<LorasConsole />
				</div>
			</WorkspacePane>
		</WorkspaceShell>
	);
}
