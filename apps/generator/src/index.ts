import { ensureDevUser, getRequestSession } from "@generator/auth";
import { env, getKafkaEventBusConfig } from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { createApp } from "@/app";

const skipAuth = env.SKIP_AUTH;
const kafkaConfig = getKafkaEventBusConfig("generator-api");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "generator-api" })
	: null;

const app = createApp({
	eventPublisher,
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
