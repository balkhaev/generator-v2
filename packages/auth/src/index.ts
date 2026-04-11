import { createDb } from "@generator/db";
import {
	account,
	session,
	user,
	verification,
} from "@generator/db/schema/auth";
import { env, getAuthConfig } from "@generator/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

const isDev = env.NODE_ENV !== "production";

const DEV_USER = {
	email: "dev@local.dev",
	password: "devdevdev123!",
	name: "Dev User",
} as const;

export function createAuth() {
	const db = createDb(env.DATABASE_URL);
	const authConfig = getAuthConfig();

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: {
				account,
				session,
				user,
				verification,
			},
		}),
		trustedOrigins: authConfig.trustedOrigins,
		emailAndPassword: {
			enabled: true,
		},
		secret: authConfig.secret,
		baseURL: authConfig.baseUrl,
		advanced: {
			defaultCookieAttributes: {
				sameSite: isDev ? "lax" : "none",
				secure: !isDev,
				httpOnly: true,
			},
		},
		plugins: [],
	});
}

export const auth = createAuth();

export async function ensureDevUser() {
	if (!isDev) {
		return;
	}

	try {
		const existing = await auth.api.signInEmail({
			body: { email: DEV_USER.email, password: DEV_USER.password },
		});
		if (existing) {
			return;
		}
	} catch {
		// user doesn't exist yet — create it
	}

	try {
		await auth.api.signUpEmail({
			body: {
				email: DEV_USER.email,
				password: DEV_USER.password,
				name: DEV_USER.name,
			},
		});
		console.info("[auth] Dev user created:", DEV_USER.email);
	} catch {
		console.info("[auth] Dev user already exists:", DEV_USER.email);
	}
}

export { DEV_USER };
