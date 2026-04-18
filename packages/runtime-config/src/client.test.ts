import { describe, expect, it } from "bun:test";

import { createRuntimeConfigClient } from "./client";
import type { RuntimeConfigSnapshot } from "./domains";

const SNAPSHOT: RuntimeConfigSnapshot = {
	credentials: { openrouter: { apiKey: "sk-or-test" } },
	domain: "prompt-enhance",
	settings: { openrouterModel: "qwen/qwen3", provider: "openrouter" },
};

function noop(): void {
	return;
}

const SILENT_LOGGER = { error: noop, warn: noop };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

describe("createRuntimeConfigClient", () => {
	it("requires a non-empty internalToken", () => {
		expect(() =>
			createRuntimeConfigClient({
				adminApiUrl: "https://admin",
				internalToken: "   ",
			})
		).toThrow();
	});

	it("returns a snapshot from admin-api on cache miss", async () => {
		let calls = 0;
		const client = createRuntimeConfigClient({
			adminApiUrl: "https://admin",
			fetchImpl: () => {
				calls += 1;
				return Promise.resolve(jsonResponse(SNAPSHOT));
			},
			internalToken: "tok",
			logger: SILENT_LOGGER,
		});
		const out = await client.get("prompt-enhance");
		expect(out).toEqual(SNAPSHOT);
		expect(calls).toBe(1);
	});

	it("serves subsequent reads from the in-memory cache", async () => {
		let calls = 0;
		const client = createRuntimeConfigClient({
			adminApiUrl: "https://admin",
			fetchImpl: () => {
				calls += 1;
				return Promise.resolve(jsonResponse(SNAPSHOT));
			},
			internalToken: "tok",
			logger: SILENT_LOGGER,
		});
		await client.get("prompt-enhance");
		await client.get("prompt-enhance");
		await client.get("prompt-enhance");
		expect(calls).toBe(1);
	});

	it("re-fetches after invalidate()", async () => {
		let calls = 0;
		const client = createRuntimeConfigClient({
			adminApiUrl: "https://admin",
			fetchImpl: () => {
				calls += 1;
				return Promise.resolve(jsonResponse(SNAPSHOT));
			},
			internalToken: "tok",
			logger: SILENT_LOGGER,
		});
		await client.get("prompt-enhance");
		client.invalidate("prompt-enhance");
		await client.get("prompt-enhance");
		expect(calls).toBe(2);
	});

	it("serves stale snapshot when admin-api errors after TTL expiry", async () => {
		let calls = 0;
		const client = createRuntimeConfigClient({
			adminApiUrl: "https://admin",
			cacheTtlMs: 0,
			fetchImpl: () => {
				calls += 1;
				if (calls === 1) {
					return Promise.resolve(jsonResponse(SNAPSHOT));
				}
				return Promise.reject(new Error("network down"));
			},
			internalToken: "tok",
			logger: SILENT_LOGGER,
		});
		const first = await client.get("prompt-enhance");
		expect(first).toEqual(SNAPSHOT);
		const second = await client.get("prompt-enhance");
		expect(second).toEqual(SNAPSHOT);
		expect(calls).toBe(2);
	});

	it("propagates the error when there is no stale snapshot", async () => {
		const client = createRuntimeConfigClient({
			adminApiUrl: "https://admin",
			fetchImpl: () => Promise.reject(new Error("network down")),
			internalToken: "tok",
			logger: SILENT_LOGGER,
		});
		await expect(client.get("prompt-enhance")).rejects.toThrow("network down");
	});

	it("rejects with descriptive message on non-2xx", async () => {
		const client = createRuntimeConfigClient({
			adminApiUrl: "https://admin",
			fetchImpl: () =>
				Promise.resolve(
					new Response("forbidden", {
						status: 403,
						statusText: "Forbidden",
					})
				),
			internalToken: "tok",
			logger: SILENT_LOGGER,
		});
		await expect(client.get("prompt-enhance")).rejects.toThrow("403");
	});

	it("coalesces concurrent requests for the same domain", async () => {
		let calls = 0;
		let resolveFetch: ((value: Response) => void) | undefined;
		const client = createRuntimeConfigClient({
			adminApiUrl: "https://admin",
			fetchImpl: () => {
				calls += 1;
				return new Promise<Response>((resolve) => {
					resolveFetch = resolve;
				});
			},
			internalToken: "tok",
			logger: SILENT_LOGGER,
		});
		const a = client.get("prompt-enhance");
		const b = client.get("prompt-enhance");
		const c = client.get("prompt-enhance");
		resolveFetch?.(jsonResponse(SNAPSHOT));
		await Promise.all([a, b, c]);
		expect(calls).toBe(1);
	});
});
