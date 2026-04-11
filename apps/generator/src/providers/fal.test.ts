import { describe, expect, it, mock } from "bun:test";

import { createFalClient, normalizeFalStatus } from "@/providers/fal";

describe("fal provider", () => {
	it("normalizes queue statuses", () => {
		expect(normalizeFalStatus("IN_QUEUE")).toBe("queued");
		expect(normalizeFalStatus("IN_PROGRESS")).toBe("running");
		expect(normalizeFalStatus("COMPLETED")).toBe("succeeded");
		expect(() => normalizeFalStatus("UNKNOWN")).toThrow(
			"Unsupported fal.ai status: UNKNOWN"
		);
	});

	it("extracts canonical endpoint from status_url and uses it for polling", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			if (url.endsWith("/fal-ai/flux/dev") && init?.method === "POST") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							request_id: "req-abc123",
							status: "IN_QUEUE",
							status_url:
								"https://queue.fal.run/fal-ai/flux/requests/req-abc123/status",
							response_url:
								"https://queue.fal.run/fal-ai/flux/requests/req-abc123",
							queue_position: 0,
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						}
					)
				);
			}

			if (url.includes("/fal-ai/flux/requests/req-abc123/status")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							status: "COMPLETED",
							request_id: "req-abc123",
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						}
					)
				);
			}

			if (url.endsWith("/fal-ai/flux/requests/req-abc123")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							images: [
								{
									url: "https://v3.fal.media/files/result.png",
									width: 1024,
									height: 1024,
								},
							],
							seed: 42,
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						}
					)
				);
			}

			throw new Error(`Unexpected URL: ${url}`);
		});

		const client = createFalClient({
			apiKey: "fal_test_key",
			fetchImpl,
		});

		const submission = await client.submit({
			__falModel: "fal-ai/flux/dev",
			prompt: "a sunset over mountains",
		});
		expect(submission).toEqual({
			endpointId: "fal-ai/flux",
			jobId: "req-abc123",
			status: "queued",
		});

		const job = await client.getStatus("req-abc123", "fal-ai/flux");
		expect(job.status).toBe("succeeded");
		expect(job.output).toMatchObject({
			images: [
				{
					url: "https://v3.fal.media/files/result.png",
					width: 1024,
					height: 1024,
				},
			],
		});
		expect(job.errorSummary).toBeNull();
	});

	it("falls back to original model when status_url is missing", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			if (init?.method === "POST") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							request_id: "req-simple",
							status: "IN_QUEUE",
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						}
					)
				);
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const client = createFalClient({
			apiKey: "fal_test_key",
			fetchImpl,
		});

		const submission = await client.submit({
			__falModel: "fal-ai/flux-lora",
			prompt: "test",
		});
		expect(submission.endpointId).toBe("fal-ai/flux-lora");
	});

	it("returns running status without fetching result", async () => {
		const fetchImpl = mock((url: string) => {
			if (url.includes("/status")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							status: "IN_PROGRESS",
							request_id: "req-running",
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						}
					)
				);
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const client = createFalClient({
			apiKey: "fal_test_key",
			fetchImpl,
		});

		const job = await client.getStatus("req-running", "fal-ai/flux");
		expect(job.status).toBe("running");
		expect(job.output).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("surfaces error from completed status", async () => {
		const fetchImpl = mock((url: string) => {
			if (url.includes("/status")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							status: "COMPLETED",
							request_id: "req-fail",
							error: "Model inference failed: out of memory",
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						}
					)
				);
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const client = createFalClient({
			apiKey: "fal_test_key",
			fetchImpl,
		});

		const job = await client.getStatus("req-fail", "fal-ai/flux");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("Model inference failed: out of memory");
		expect(job.output).toBeNull();
	});

	it("throws on API errors with detail messages", async () => {
		const fetchImpl = mock(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({ detail: "Unauthorized: invalid API key" }),
					{
						status: 401,
						headers: { "content-type": "application/json" },
					}
				)
			);
		});

		const client = createFalClient({
			apiKey: "bad_key",
			fetchImpl,
		});

		await expect(
			client.submit({
				__falModel: "fal-ai/flux/schnell",
				prompt: "test",
			})
		).rejects.toThrow("Unauthorized: invalid API key");
	});

	it("throws when __falModel is missing from payload", async () => {
		const client = createFalClient({
			apiKey: "fal_test_key",
			fetchImpl: mock(() => {
				throw new Error("should not be called");
			}),
		});

		await expect(client.submit({ prompt: "test" })).rejects.toThrow(
			"fal.ai provider requires __falModel in payload"
		);
	});

	it("cancels requests best-effort via PUT", async () => {
		let cancelCalled = false;
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			if (url.includes("/cancel") && init?.method === "PUT") {
				cancelCalled = true;
				return Promise.resolve(
					new Response(JSON.stringify({ status: "CANCELLATION_REQUESTED" }), {
						status: 202,
						headers: { "content-type": "application/json" },
					})
				);
			}
			throw new Error(`Unexpected URL: ${url}`);
		});

		const client = createFalClient({
			apiKey: "fal_test_key",
			fetchImpl,
		});

		await client.cancel("req-abc123", "fal-ai/flux");
		expect(cancelCalled).toBe(true);
	});

	it("sets authorization header correctly", async () => {
		let capturedHeaders: Record<string, string> = {};
		const fetchImpl = mock((_url: string, init?: RequestInit) => {
			capturedHeaders = init?.headers as Record<string, string>;
			return Promise.resolve(
				new Response(
					JSON.stringify({
						request_id: "req-1",
						status: "IN_QUEUE",
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					}
				)
			);
		});

		const client = createFalClient({
			apiKey: "fal_my_secret_key",
			fetchImpl,
		});

		await client.submit({
			__falModel: "fal-ai/flux/schnell",
			prompt: "test",
		});
		expect(capturedHeaders.authorization).toBe("Key fal_my_secret_key");
	});
});
