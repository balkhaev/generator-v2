import { ensureDevUser, getRequestSession } from "@generator/auth";
import { createApp } from "@/app";

const skipAuth = process.env.SKIP_AUTH === "true";

const app = createApp({
	getSession: skipAuth ? undefined : getRequestSession,
	loggerImpl: console,
	redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
});

if (!skipAuth) {
	ensureDevUser();
}

export default {
	maxRequestBodySize: 3_000_000_000,
	port: Number(process.env.PORT ?? 3005),
	fetch: app.fetch,
};
