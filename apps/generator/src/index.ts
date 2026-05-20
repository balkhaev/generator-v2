import { ensureDevUser, getRequestSession } from "@generator/auth";
import { env, getKafkaEventBusConfig } from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { resolveS3StorageConfig } from "@generator/storage";
import { createApp } from "@/app";
import { startRunpodRegistryReloadWatcher } from "@/providers/runpod-registry-reload-watcher";
import { loadRunpodWorkflowsFromDb } from "@/providers/runpod-template-loader";
import { seedRunpodTemplatesFromEnv } from "@/providers/runpod-template-seed";
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

/**
 * Backward-compat one-shot seed: если таблица `runpod_pod_template` пуста,
 * автоматически переносим текущий env-конфиг в БД при первом старте.
 * Это позволяет деплоить новую версию без ручного бэкапа sids — старый env
 * сразу превращается в admin-managed template'ы. На последующих стартах
 * сидер видит non-empty таблицу и сразу выходит.
 */
await seedRunpodTemplatesFromEnv({ logger: console });

/**
 * Подгружаем admin-managed RunPod workflows из БД до старта `createApp`.
 * Если БД пуста (что-то совсем сломалось с сидом или сидер ничего не нашёл) —
 * массив остаётся пустым и `createConfiguredRunpodService` падает на
 * env-defaults. Один preload на процесс: hot reload через restart.
 */
const runpodWorkflows = await loadRunpodWorkflowsFromDb({ logger: console });
if (runpodWorkflows.length > 0) {
	console.info("generator.runpod.workflows-loaded-from-db", {
		count: runpodWorkflows.length,
		ids: runpodWorkflows.map((w) => w.id),
	});
}

const app = createApp({
	eventPublisher,
	getSession: skipAuth ? undefined : getRequestSession,
	loggerImpl: console,
	redisUrl: env.REDIS_URL,
	runpodWorkflows,
	storageAdapter,
});

if (!skipAuth) {
	ensureDevUser();
}

/**
 * Hot-reload registry: admin при mutation RunPod template/volume/binding
 * publish'ит на Redis pub/sub. Watcher здесь делает graceful SIGTERM,
 * orchestrator (Docker / Coolify) поднимает процесс заново — и новый
 * процесс читает свежий registry из БД через `loadRunpodWorkflowsFromDb`.
 */
const runpodReloadWatcher = startRunpodRegistryReloadWatcher({
	logger: console,
	processLabel: "generator-api",
	redisUrl: env.REDIS_URL,
});

if (eventPublisher || runpodReloadWatcher) {
	const shutdown = () => {
		runpodReloadWatcher?.close().catch((error) => {
			console.error("generator.runpod-reload-watcher.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
		eventPublisher?.close().catch((error) => {
			console.error("generator.events-publisher.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

export default {
	maxRequestBodySize: 3_000_000_000,
	port: Number(process.env.PORT ?? 3005),
	fetch: app.fetch,
};
