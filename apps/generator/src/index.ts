import { ensureDevUser, getRequestSession } from "@generator/auth";
import { env, getKafkaEventBusConfig } from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { resolveS3StorageConfig } from "@generator/storage";
import { createApp } from "@/app";
import { createStorageAdapter } from "@/providers/storage";

const skipAuth = env.SKIP_AUTH;
const kafkaConfig = getKafkaEventBusConfig("generator-api");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "generator-api" })
	: null;

const s3Config = resolveS3StorageConfig();
const storageAdapter = createStorageAdapter({
	config: s3Config,
	logger: console,
});

const app = createApp({
	eventPublisher,
	getSession: skipAuth ? undefined : getRequestSession,
	loggerImpl: console,
	redisUrl: env.REDIS_URL,
	storageAdapter,
});

if (!skipAuth) {
	ensureDevUser();
}

export default {
	maxRequestBodySize: 3_000_000_000,
	port: Number(process.env.PORT ?? 3005),
	fetch: app.fetch,
};
