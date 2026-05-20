import { describe, expect, it, mock } from "bun:test";

import {
	createRunpodHttpClient,
	isNoCapacityError,
	isRetryableNetworkError,
	isRetryableStatus,
	type RunpodRetryEvent,
} from "./client";

const ABORT_PATTERN = /abort/i;

function noopSleep(_ms: number): Promise<void> {
	return Promise.resolve();
}

describe("RunpodHttpClient", () => {
	it("strips trailing slashes from baseUrl and sends bearer auth", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://api.runpod.ai/v2/endpoint/run");
			expect(init?.headers).toMatchObject({
				authorization: "Bearer rpa_test",
				"content-type": "application/json",
			});
			return Promise.resolve(
				Response.json({ id: "job-1", status: "IN_QUEUE" })
			);
		});
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://api.runpod.ai/v2/",
			fetchImpl,
		});

		const body = await client.post(
			"/endpoint/run",
			{ input: { hello: "world" } },
			"runpod /run"
		);

		expect(body).toEqual({ id: "job-1", status: "IN_QUEUE" });
	});

	it("extracts nested error.message from JSON failures", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				Response.json(
					{ error: { message: "endpoint locked" } },
					{ status: 403 }
				)
			)
		);
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://api.runpod.ai/v2",
			fetchImpl,
			sleep: noopSleep,
		});

		await expect(
			client.post("/x/run", undefined, "runpod /run")
		).rejects.toThrow("runpod /run failed (403): endpoint locked");
	});

	it("treats 204 No Content as a successful empty body", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(new Response(null, { status: 204 }))
		);
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://rest.runpod.io/v1",
			fetchImpl,
		});

		await expect(
			client.delete("/pods/abc", "delete pod")
		).resolves.toBeUndefined();
	});

	it("aborts requests once the timeout elapses", async () => {
		const fetchImpl = mock((_url: string, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new DOMException("aborted", "AbortError"));
				});
			});
		});
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://api.runpod.ai/v2",
			fetchImpl,
			timeoutMs: 5,
			retry: { maxAttempts: 1 },
		});

		await expect(client.get("/endpoint/health", "health")).rejects.toThrow(
			ABORT_PATTERN
		);
	});

	it("recognises no-capacity errors", () => {
		expect(isNoCapacityError(new Error("No instances available"))).toBe(true);
		expect(
			isNoCapacityError(new Error("server does not have the resources"))
		).toBe(true);
		expect(isNoCapacityError(new Error("internal server error"))).toBe(false);
		expect(isNoCapacityError("string error")).toBe(false);
	});

	it("retries 5xx responses up to maxAttempts and surfaces the final error", async () => {
		let attempts = 0;
		const fetchImpl = mock(() => {
			attempts += 1;
			return Promise.resolve(Response.json({ error: "boom" }, { status: 503 }));
		});
		const onRetry = mock((_event: RunpodRetryEvent) => undefined);
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://api.runpod.ai/v2",
			fetchImpl,
			retry: { maxAttempts: 3, onRetry },
			sleep: noopSleep,
		});

		await expect(
			client.post("/endpoint/run", { input: {} }, "/run")
		).rejects.toThrow("/run failed (503): boom");
		expect(attempts).toBe(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
	});

	it("retries 429 with Retry-After header and ultimately succeeds", async () => {
		let attempts = 0;
		const fetchImpl = mock(() => {
			attempts += 1;
			if (attempts === 1) {
				return Promise.resolve(
					new Response("rate limited", {
						status: 429,
						headers: { "retry-after": "0.05" },
					})
				);
			}
			return Promise.resolve(
				Response.json({ id: "job-2", status: "IN_QUEUE" })
			);
		});
		const events: RunpodRetryEvent[] = [];
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://api.runpod.ai/v2",
			fetchImpl,
			retry: { maxAttempts: 3, onRetry: (e) => events.push(e) },
			sleep: noopSleep,
		});

		const body = await client.post("/x/run", { input: {} }, "/run");
		expect(body).toEqual({ id: "job-2", status: "IN_QUEUE" });
		expect(attempts).toBe(2);
		expect(events[0]?.status).toBe(429);
		expect(events[0]?.delayMs).toBe(50);
	});

	it("retries transient network errors (fetch failed)", async () => {
		let attempts = 0;
		const fetchImpl = mock(() => {
			attempts += 1;
			if (attempts === 1) {
				return Promise.reject(new Error("fetch failed: ECONNRESET"));
			}
			return Promise.resolve(Response.json({ ok: true }));
		});
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://api.runpod.ai/v2",
			fetchImpl,
			retry: { maxAttempts: 2 },
			sleep: noopSleep,
		});

		const result = await client.get("/x/status/y", "/status");
		expect(result).toEqual({ ok: true });
		expect(attempts).toBe(2);
	});

	it("does not retry 4xx (other than 429) — they are caller errors", async () => {
		let attempts = 0;
		const fetchImpl = mock(() => {
			attempts += 1;
			return Promise.resolve(
				Response.json({ error: "bad request" }, { status: 400 })
			);
		});
		const client = createRunpodHttpClient({
			apiKey: "rpa_test",
			baseUrl: "https://api.runpod.ai/v2",
			fetchImpl,
			retry: { maxAttempts: 5 },
			sleep: noopSleep,
		});

		await expect(client.post("/x/run", undefined, "/run")).rejects.toThrow(
			"/run failed (400): bad request"
		);
		expect(attempts).toBe(1);
	});

	it("classifies retry-eligible statuses and network errors", () => {
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(500)).toBe(true);
		expect(isRetryableStatus(502)).toBe(true);
		expect(isRetryableStatus(404)).toBe(false);
		expect(isRetryableNetworkError(new Error("fetch failed"))).toBe(true);
		expect(isRetryableNetworkError(new Error("ECONNRESET"))).toBe(true);
		expect(
			isRetryableNetworkError(new DOMException("aborted", "AbortError"))
		).toBe(true);
		expect(isRetryableNetworkError(new Error("bad input"))).toBe(false);
	});
});
