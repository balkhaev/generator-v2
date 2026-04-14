"use client";

import { DevAutoLogin } from "@generator/auth-client/dev-auto-login";
import { useRouter } from "next/navigation";
import { useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginScreen({
	setupRequired,
}: {
	setupRequired: boolean;
}) {
	const [showSignIn, setShowSignIn] = useState(!setupRequired);
	const router = useRouter();
	const showSignInForm = !setupRequired && showSignIn;

	return (
		<DevAutoLogin onSuccess={() => router.push("/")}>
			<main className="flex min-h-svh items-center justify-center p-4">
				{showSignInForm ? (
					<SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
				) : (
					<SignUpForm
						onSwitchToSignIn={() => setShowSignIn(true)}
						setupRequired={setupRequired}
					/>
				)}
			</main>
		</DevAutoLogin>
	);
}
