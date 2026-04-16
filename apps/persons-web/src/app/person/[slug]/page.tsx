import { authClient } from "@generator/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import PersonsWorkspace from "@/components/persons-workspace";
import { getPersonsDashboardForRequest } from "@/lib/persons-api-server";

export const dynamic = "force-dynamic";

export default async function PersonPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const requestHeaders = await headers();

	try {
		const session = await authClient.getSession({
			fetchOptions: {
				headers: requestHeaders,
				throw: true,
			},
		});

		if (!session?.user) {
			redirect("/login");
		}
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"digest" in error &&
			typeof error.digest === "string" &&
			error.digest.startsWith("NEXT_REDIRECT")
		) {
			throw error;
		}

		redirect("/login");
	}

	const snapshot = await getPersonsDashboardForRequest(requestHeaders);

	return <PersonsWorkspace initialSnapshot={snapshot} personSlug={slug} />;
}
