"use client";

import { useEffect, useState } from "react";
import { authClient, DEV_USER } from "./index";

const isDev = process.env.NODE_ENV === "development";

export function useDevAutoLogin(options: { onSuccess: () => void }) {
	const [attempting, setAttempting] = useState(isDev);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!isDev) {
			return;
		}

		authClient.signIn
			.email({
				email: DEV_USER.email,
				password: DEV_USER.password,
			})
			.then((result) => {
				if (result.error) {
					setFailed(true);
					setAttempting(false);
					return;
				}
				options.onSuccess();
			})
			.catch(() => {
				setFailed(true);
				setAttempting(false);
			});
	}, [options.onSuccess]);

	return { attempting: attempting && !failed, failed };
}

export function DevAutoLogin({
	children,
	onSuccess,
}: {
	children: React.ReactNode;
	onSuccess: () => void;
}) {
	const { attempting } = useDevAutoLogin({ onSuccess });

	if (attempting) {
		return (
			<div className="flex min-h-svh items-center justify-center p-4">
				<div className="grid gap-3 text-center">
					<div className="mx-auto size-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
					<p className="font-mono text-muted-foreground text-xs">
						Dev auto-login...
					</p>
				</div>
			</div>
		);
	}

	return children;
}
