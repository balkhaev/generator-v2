"use client";

import { DevAutoLogin } from "@generator/auth-client/dev-auto-login";
import { useRouter } from "next/navigation";
import { useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginPage() {
	const [showSignIn, setShowSignIn] = useState(true);
	const router = useRouter();

	return (
		<DevAutoLogin onSuccess={() => router.push("/")}>
			<main className="flex min-h-svh items-center justify-center p-4">
				{showSignIn ? (
					<SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
				) : (
					<SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
				)}
			</main>
		</DevAutoLogin>
	);
}
