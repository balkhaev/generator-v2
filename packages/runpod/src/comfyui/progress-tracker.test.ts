import { describe, expect, it } from "bun:test";

import {
	buildComfyWebSocketUrl,
	type ComfyProgressTracker,
	createComfyProgressTracker,
	mergeRunningProgress,
} from "./progress-tracker";

describe("buildComfyWebSocketUrl", () => {
	it("maps https base URL to wss websocket endpoint", () => {
		expect(
			buildComfyWebSocketUrl("https://abc-8188.proxy.runpod.net", "client-1")
		).toBe("wss://abc-8188.proxy.runpod.net/ws?clientId=client-1");
	});
});

describe("mergeRunningProgress", () => {
	it("prefers live snapshot over coarse fallback and keeps monotonic pct", () => {
		const tracker: ComfyProgressTracker = {
			ensureTracking: () => undefined,
			getSnapshot: () => ({
				lastLogLine: "KSampler 3/8",
				progressPct: 38,
				updatedAt: Date.now(),
			}),
			stopTracking: () => undefined,
		};

		expect(
			mergeRunningProgress({
				clientId: "req-1",
				fallbackPct: 75,
				tracker,
			})
		).toEqual({
			lastLogLine: "KSampler 3/8",
			progressPct: 75,
		});
	});

	it("returns fallback when tracker has no snapshot yet", () => {
		const tracker = createComfyProgressTracker();
		expect(
			mergeRunningProgress({
				clientId: "req-2",
				fallbackPct: 30,
				tracker,
				tracking: {
					baseUrl: "https://example.test",
					clientId: "req-2",
				},
			})
		).toEqual({
			lastLogLine: null,
			progressPct: 30,
		});
	});
});
