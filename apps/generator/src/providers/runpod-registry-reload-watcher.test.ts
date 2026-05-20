import { describe, expect, it } from "bun:test";
import {
	parseReloadEvent,
	RUNPOD_REGISTRY_RELOAD_CHANNEL,
	type RunpodRegistryReloadEvent,
	serializeReloadEvent,
} from "@generator/runpod";

/**
 * Watcher строится поверх `createRedisSubscriber`. Этот тест проверяет
 * только нашу часть склейки — что parseReloadEvent + (de)serialize
 * правильно матчатся с тем, что выдаёт publisher в admin'е, и что
 * канал — тот самый. Сам Redis pub/sub не запускаем: это integration,
 * прогоняется отдельным smoke-тестом в проде.
 */
describe("runpod registry reload watcher contract", () => {
	it("agrees on channel name", () => {
		expect(RUNPOD_REGISTRY_RELOAD_CHANNEL).toBe("runpod:registry:reload");
	});

	it("round-trips events through serialize/parse", () => {
		const event: RunpodRegistryReloadEvent = {
			at: new Date("2026-05-20T12:00:00.000Z").toISOString(),
			kind: "pod-template-updated",
			resourceId: "tpl-1",
			triggeredBy: "admin-api",
		};
		expect(parseReloadEvent(serializeReloadEvent(event))).toEqual(event);
	});

	it("returns null when payload is corrupted (watcher just logs)", () => {
		expect(parseReloadEvent("not-json")).toBeNull();
	});
});
