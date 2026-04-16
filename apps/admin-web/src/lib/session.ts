import "server-only";

import { authClient } from "@generator/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function requireSession() {
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

		return { requestHeaders, session };
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
}

export function getModuleUrls() {
	return {
		studioUrl: process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3002",
		personsUrl: process.env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004",
	};
}
