import { authClient } from "@generator/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import ReferenceVariantPicker from "@/components/reference-variant-picker";

export const dynamic = "force-dynamic";

export default async function NewReferencesPage() {
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

	return <ReferenceVariantPicker />;
}
