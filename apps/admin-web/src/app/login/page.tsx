import { authClient } from "@generator/auth-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import LoginScreen from "@/components/login-screen";
import { getAdminSetupStatus } from "@/lib/admin-setup";

export default async function LoginPage() {
	const requestHeaders = await headers();

	try {
		const session = await authClient.getSession({
			fetchOptions: {
				headers: requestHeaders,
				throw: true,
			},
		});

		if (session?.user) {
			redirect("/");
		}
	} catch {
		// Ignore auth lookup failures here and fall back to the login shell.
	}

	const setupStatus = await getAdminSetupStatus(requestHeaders);

	return <LoginScreen setupRequired={setupStatus.setupRequired} />;
}
