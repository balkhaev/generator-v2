import { authClient } from "@generator/auth-client";
import { getStudioSnapshotForRequest } from "@generator/studio-client/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import ShotsView from "@/components/shots/shots-view";
import { listPersonsForRequest } from "@/lib/persons-server";

export const dynamic = "force-dynamic";

export default async function ShotsPage() {
	const requestHeaders = await headers();
	const gatewayBaseUrl =
		process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3006";

	const session = await authClient.getSession({
		fetchOptions: {
			headers: requestHeaders,
			throw: true,
		},
	});

	if (!session?.user) {
		redirect("/login");
	}

	const [snapshot, personsResult] = await Promise.all([
		getStudioSnapshotForRequest(gatewayBaseUrl, requestHeaders),
		listPersonsForRequest(requestHeaders),
	]);

	return (
		<ShotsView
			persons={personsResult.persons}
			sessionEmail={session.user.email ?? null}
			sessionName={session.user.name}
			shots={snapshot.shots}
			warnings={[...snapshot.warnings, ...personsResult.warnings]}
		/>
	);
}
