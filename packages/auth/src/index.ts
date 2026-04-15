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
import { APIError } from "better-auth/api";

import { deriveCrossSubdomainCookieDomain } from "./cookie-domain";

const isDev = env.NODE_ENV !== "production";
const db = createDb(env.DATABASE_URL);

const DEV_USER = {
	email: "dev@local.dev",
	password: "devdevdev123!",
	name: "Dev User",
} as const;

export function createAuth() {
	const authConfig = getAuthConfig();
	const crossSubdomainCookieDomain =
		authConfig.cookieDomain ??
		deriveCrossSubdomainCookieDomain(authConfig.baseUrl);

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
			...(crossSubdomainCookieDomain
				? {
						crossSubDomainCookies: {
							domain: crossSubdomainCookieDomain,
							enabled: true,
						},
					}
				: {}),
			defaultCookieAttributes: {
				sameSite: isDev ? "lax" : "none",
				secure: !isDev,
				httpOnly: true,
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (userData) => {
						if (isDev && userData.email === DEV_USER.email) {
							return { data: userData };
						}

						if (!(await isInitialAdminSetupRequired())) {
							throw new APIError("BAD_REQUEST", {
								message:
									"Initial admin account has already been created. Sign in instead.",
							});
						}

						return { data: userData };
					},
				},
			},
		},
		plugins: [],
	});
}

export const auth = createAuth();

export function handleAuthRequest(request: Request) {
	return auth.handler(request);
}

export function getRequestSession(request: Request) {
	return auth.api.getSession({ headers: request.headers });
}

export async function isInitialAdminSetupRequired() {
	const existingUsers = await db
		.select({
			id: user.id,
		})
		.from(user)
		.limit(1);

	return existingUsers.length === 0;
}

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
