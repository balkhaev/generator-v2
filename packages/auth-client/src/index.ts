import { env } from "@generator/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: env.NEXT_PUBLIC_SERVER_URL,
});

export const DEV_USER = {
	email: "dev@local.dev",
	password: "devdevdev123!",
} as const;
