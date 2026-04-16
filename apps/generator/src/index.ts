import { ensureDevUser, getRequestSession } from "@generator/auth";
import { env } from "@generator/env/server";
import { createApp } from "@/app";

const skipAuth = env.SKIP_AUTH;

const app = createApp({
	getSession: skipAuth ? undefined : getRequestSession,
	loggerImpl: console,
	redisUrl: env.REDIS_URL,
});

if (!skipAuth) {
	ensureDevUser();
}

export default {
	maxRequestBodySize: 3_000_000_000,
	port: Number(process.env.PORT ?? 3005),
	fetch: app.fetch,
};
