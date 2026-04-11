import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const clientSchema = {
	NEXT_PUBLIC_ADMIN_URL: z.url().optional(),
	NEXT_PUBLIC_PERSONS_API_URL: z.url().optional(),
	NEXT_PUBLIC_PERSONS_URL: z.url().optional(),
	NEXT_PUBLIC_SERVER_URL: z.url(),
	NEXT_PUBLIC_STUDIO_URL: z.url().optional(),
};
// NEXT_PUBLIC_* должен читаться как process.env.* напрямую — иначе Next не инлайнит в клиент.
function createWebEnv(override) {
	return createEnv({
		client: clientSchema,
		runtimeEnv: {
			NEXT_PUBLIC_ADMIN_URL:
				override?.NEXT_PUBLIC_ADMIN_URL ?? process.env.NEXT_PUBLIC_ADMIN_URL,
			NEXT_PUBLIC_PERSONS_API_URL:
				override?.NEXT_PUBLIC_PERSONS_API_URL ??
				process.env.NEXT_PUBLIC_PERSONS_API_URL,
			NEXT_PUBLIC_PERSONS_URL:
				override?.NEXT_PUBLIC_PERSONS_URL ??
				process.env.NEXT_PUBLIC_PERSONS_URL,
			NEXT_PUBLIC_SERVER_URL:
				override?.NEXT_PUBLIC_SERVER_URL ?? process.env.NEXT_PUBLIC_SERVER_URL,
			NEXT_PUBLIC_STUDIO_URL:
				override?.NEXT_PUBLIC_STUDIO_URL ?? process.env.NEXT_PUBLIC_STUDIO_URL,
		},
		emptyStringAsUndefined: true,
	});
}
let cachedEnv = null;
function getWebEnv() {
	cachedEnv ??= createWebEnv();
	return cachedEnv;
}
export const env = new Proxy(
	{},
	{
		get(_, property) {
			return getWebEnv()[property];
		},
	}
);
