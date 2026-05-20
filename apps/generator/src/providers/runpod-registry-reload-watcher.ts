import { createRedisSubscriber, type RedisSubscriber } from "@generator/queue";
import {
	parseReloadEvent,
	RUNPOD_REGISTRY_RELOAD_CHANNEL,
	type RunpodRegistryReloadEvent,
} from "@generator/runpod";

export interface RunpodRegistryReloadWatcherOptions {
	logger?: Pick<Console, "error" | "info" | "warn">;
	/**
	 * Что делать при reload event. По умолчанию — graceful SIGTERM
	 * самому себе: orchestrator (Docker / Coolify) поднимет процесс
	 * заново, и при следующем старте generator перечитает БД через
	 * `loadRunpodWorkflowsFromDb`. Этот колбэк инжектируется отдельным
	 * параметром, чтобы тесты могли убедиться что watcher дёрнул его
	 * без необходимости реально терминировать процесс.
	 */
	onReload?: (event: RunpodRegistryReloadEvent) => void;
	/**
	 * Идентификатор процесса в логах. Помогает увидеть в Coolify logs,
	 * какой именно service (`generator-api` / `generator-worker`)
	 * прореагировал на reload event.
	 */
	processLabel: string;
	redisUrl: string;
}

const DEFAULT_RELOAD = (
	processLabel: string,
	logger: Pick<Console, "info"> | undefined
): ((event: RunpodRegistryReloadEvent) => void) => {
	return (event) => {
		logger?.info?.("runpod.registry.reload.self-restart", {
			at: event.at,
			kind: event.kind,
			processLabel,
			resourceId: event.resourceId,
		});
		// Graceful: даём существующим shutdown-хендлерам (BullMQ worker,
		// Kafka publisher, Redis quit) корректно дренировать. Orchestrator
		// рестартит процесс автоматически, и новая инстанция перечитает
		// admin-managed registry из БД при старте.
		process.kill(process.pid, "SIGTERM");
	};
};

/**
 * Подписывается на Redis pub/sub канал admin-managed RunPod registry.
 * Возвращает handle с `close()` для graceful shutdown'а самого
 * подписчика (например в SIGTERM-обработчике). Молча no-op'ит если
 * `redisUrl` пустой — тесты могут поднимать generator без Redis.
 */
export function startRunpodRegistryReloadWatcher(
	options: RunpodRegistryReloadWatcherOptions
): RedisSubscriber | null {
	if (!options.redisUrl) {
		return null;
	}
	const onReload =
		options.onReload ?? DEFAULT_RELOAD(options.processLabel, options.logger);
	return createRedisSubscriber({
		channel: RUNPOD_REGISTRY_RELOAD_CHANNEL,
		logger: options.logger,
		onMessage: (payload) => {
			const event = parseReloadEvent(payload);
			if (!event) {
				options.logger?.warn?.("runpod.registry.reload.bad-payload", {
					payload,
					processLabel: options.processLabel,
				});
				return;
			}
			onReload(event);
		},
		redisUrl: options.redisUrl,
	});
}
