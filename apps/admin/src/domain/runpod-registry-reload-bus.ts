import type { RedisPublisher } from "@generator/queue";
import {
	RUNPOD_REGISTRY_RELOAD_CHANNEL,
	type RunpodRegistryReloadEvent,
	type RunpodRegistryReloadKind,
	serializeReloadEvent,
} from "@generator/runpod";

/**
 * Domain-уровневая абстракция над Redis pub/sub'ом, чтобы routes/domain
 * не зависели от ioredis напрямую. RunpodAdminService и
 * scenario-binding route'ы зовут `publish` при любых successful mutation
 * (`pod-template-*`, `volume-*`, `scenario-binding-updated`), а
 * generator-api / generator-worker подписаны на тот же канал и делают
 * graceful self-restart, чтобы перечитать registry из БД.
 *
 * Реализация (Redis publisher) живёт в apps/admin/src/index.ts; тесты
 * подкидывают in-memory заглушку и проверяют что publish дёрнули.
 */
export interface RunpodRegistryReloadBus {
	publish(
		kind: RunpodRegistryReloadKind,
		options?: { resourceId?: string; triggeredBy?: string }
	): Promise<void>;
}

export function createNoopRunpodRegistryReloadBus(): RunpodRegistryReloadBus {
	return {
		publish() {
			return Promise.resolve();
		},
	};
}

export interface CreateRedisReloadBusOptions {
	logger?: Pick<Console, "error" | "warn">;
	publisher: RedisPublisher;
	/**
	 * Идентификатор источника публикации, попадает в `triggeredBy` если
	 * вызывающий не передал свой. Полезно различать "admin-api" /
	 * "test" / "system" в логах consumer'ов.
	 */
	source: string;
}

/**
 * Best-effort publisher: один Redis blip не должен ронять HTTP handler
 * админки, который и так успешно записал изменение в БД. Если publish
 * упал — логируем и идём дальше. Operator увидит warning и сможет
 * руками дёрнуть redeploy generator'а.
 */
export function createRedisRunpodRegistryReloadBus(
	options: CreateRedisReloadBusOptions
): RunpodRegistryReloadBus {
	return {
		async publish(kind, opts) {
			const event: RunpodRegistryReloadEvent = {
				at: new Date().toISOString(),
				kind,
				resourceId: opts?.resourceId,
				triggeredBy: opts?.triggeredBy ?? options.source,
			};
			try {
				await options.publisher.publish(
					RUNPOD_REGISTRY_RELOAD_CHANNEL,
					serializeReloadEvent(event)
				);
			} catch (error) {
				options.logger?.warn?.("runpod.registry.reload.publish.failed", {
					kind,
					message: error instanceof Error ? error.message : "unknown",
					resourceId: opts?.resourceId,
				});
			}
		},
	};
}
