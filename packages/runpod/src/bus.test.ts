import { describe, expect, it } from "bun:test";
import {
	parseReloadEvent,
	RUNPOD_REGISTRY_RELOAD_CHANNEL,
	type RunpodRegistryReloadEvent,
	serializeReloadEvent,
} from "./bus";

describe("RUNPOD_REGISTRY_RELOAD_CHANNEL", () => {
	it("is a stable string so publisher and subscriber agree", () => {
		expect(RUNPOD_REGISTRY_RELOAD_CHANNEL).toBe("runpod:registry:reload");
	});
});

describe("serializeReloadEvent / parseReloadEvent", () => {
	it("round-trips a full event", () => {
		const event: RunpodRegistryReloadEvent = {
			at: "2026-05-20T12:00:00.000Z",
			kind: "pod-template-updated",
			resourceId: "tpl-123",
			triggeredBy: "admin-user-1",
		};
		const parsed = parseReloadEvent(serializeReloadEvent(event));
		expect(parsed).toEqual(event);
	});

	it("round-trips an event without optional fields", () => {
		const event: RunpodRegistryReloadEvent = {
			at: "2026-05-20T12:00:00.000Z",
			kind: "scenario-binding-updated",
		};
		const parsed = parseReloadEvent(serializeReloadEvent(event));
		expect(parsed).toEqual(event);
	});

	it("returns null for malformed JSON", () => {
		expect(parseReloadEvent("{not-json")).toBeNull();
	});

	it("returns null when required fields are missing", () => {
		expect(parseReloadEvent(JSON.stringify({ kind: "x" }))).toBeNull();
		expect(parseReloadEvent(JSON.stringify({ at: "now" }))).toBeNull();
	});

	it("ignores extra fields without failing", () => {
		const parsed = parseReloadEvent(
			JSON.stringify({
				at: "2026-05-20T12:00:00.000Z",
				extra: "ignored",
				kind: "volume-created",
			})
		);
		expect(parsed).toEqual({
			at: "2026-05-20T12:00:00.000Z",
			kind: "volume-created",
		});
	});
});
