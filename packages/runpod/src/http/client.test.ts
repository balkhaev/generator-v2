import { describe, expect, it, mock } from "bun:test";

import { createRunpodHttpClient, isNoCapacityError } from "./client";

const ABORT_PATTERN = /abort/i;

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
});
