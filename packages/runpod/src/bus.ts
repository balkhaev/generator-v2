/**
 * Redis pub/sub канал и payload для оповещения generator-инстансов о том,
 * что admin-managed RunPod registry в БД изменился (template, volume,
 * scenario→template binding). Generator-api / generator-worker подписаны
 * на этот канал и при получении события выполняют graceful self-restart
 * (SIGTERM), чтобы перечитать registry из БД при следующем старте.
 *
 * Канал хранится тут, а не в admin/generator-локальных модулях, потому что
 * **publisher** (admin) и **subscriber** (generator) должны импортировать
 * одну и ту же строку. Любой случайный typo в одной из сторон полностью
 * сломает hot-reload, причём молча.
 */
export const RUNPOD_REGISTRY_RELOAD_CHANNEL = "runpod:registry:reload";

/**
 * Что именно изменилось — для логов и debug. Не используется для роутинга:
 * generator на любое событие просто делает full reload, чтобы не пытаться
 * угадывать какие подсистемы инвалидировать.
 */
export type RunpodRegistryReloadKind =
	| "pod-template-created"
	| "pod-template-deleted"
	| "pod-template-updated"
	| "scenario-binding-updated"
	| "volume-created"
	| "volume-deleted"
	| "volume-updated";

export interface RunpodRegistryReloadEvent {
	/** ISO-8601 timestamp когда событие было опубликовано admin'ом. */
	at: string;
	/** Что изменилось (для логов на стороне generator'а). */
	kind: RunpodRegistryReloadKind;
	/** Опциональный stable identifier ресурса (template id, volume id, scenario id). */
	resourceId?: string;
	/** Кто триггернул (admin user id / "system" / "test"). Только для аудита. */
	triggeredBy?: string;
}

export function serializeReloadEvent(event: RunpodRegistryReloadEvent): string {
	return JSON.stringify(event);
}

/**
 * Tolerant parser: возвращает null если payload не валиден, чтобы один
 * битый publish не положил подписчика. Подписчик логирует и продолжает.
 */
export function parseReloadEvent(
	raw: string
): RunpodRegistryReloadEvent | null {
	let candidate: unknown;
	try {
		candidate = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!candidate || typeof candidate !== "object") {
		return null;
	}
	const obj = candidate as Record<string, unknown>;
	if (typeof obj.kind !== "string" || typeof obj.at !== "string") {
		return null;
	}
	return {
		at: obj.at,
		kind: obj.kind as RunpodRegistryReloadKind,
		resourceId: typeof obj.resourceId === "string" ? obj.resourceId : undefined,
		triggeredBy:
			typeof obj.triggeredBy === "string" ? obj.triggeredBy : undefined,
	};
}
