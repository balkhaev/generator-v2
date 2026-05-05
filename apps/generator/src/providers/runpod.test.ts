import { describe, expect, it, mock } from "bun:test";

import {
	createRunpodClient,
	formatRunpodProviderEndpointId,
	normalizeRunpodStatus,
} from "@/providers/runpod";

describe("runpod provider", () => {
	it("normalizes queue statuses", () => {
		expect(normalizeRunpodStatus("IN_QUEUE")).toBe("queued");
		expect(normalizeRunpodStatus("IN_PROGRESS")).toBe("running");
		expect(normalizeRunpodStatus("COMPLETED")).toBe("succeeded");
		expect(normalizeRunpodStatus("FAILED")).toBe("failed");
		expect(normalizeRunpodStatus("ERROR")).toBe("failed");
		expect(() => normalizeRunpodStatus("UNKNOWN")).toThrow(
			"Unsupported RunPod status: UNKNOWN"
		);
	});

	it("submits to the configured endpoint and strips internal routing keys", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://api.runpod.ai/v2/endpoint-xyz/run");
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				authorization: "Bearer rpa_test_key",
				"content-type": "application/json",
			});
			expect(JSON.parse(String(init?.body))).toEqual({
				input: {
					loras: [
						{
							url: "https://example.com/sdxl.safetensors",
							weight: 0.8,
						},
					],
					prompt: "test",
				},
			});
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "rp-job-123",
						status: "IN_QUEUE",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createRunpodClient({
			apiKey: "rpa_test_key",
			endpoints: {
				"fooocus-sdxl": "endpoint-xyz",
			},
			fetchImpl,
		});

		const submission = await client.submit({
			__runpodEndpoint: "fooocus-sdxl",
			loras: [
				{
					url: "https://example.com/sdxl.safetensors",
					weight: 0.8,
				},
			],
			prompt: "test",
		});

		expect(submission).toEqual({
			endpointId: "runpod:endpoint-xyz",
			jobId: "rp-job-123",
			queuePosition: null,
			status: "queued",
		});
	});

	it("returns completed output from /status", async () => {
		const fetchImpl = mock((url: string) => {
			expect(url).toBe(
				"https://api.runpod.ai/v2/endpoint-xyz/status/rp-job-123"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "rp-job-123",
						output: {
							images: [{ url: "https://assets.example.com/out.png" }],
						},
						status: "COMPLETED",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createRunpodClient({
			apiKey: "rpa_test_key",
			endpoints: { "fooocus-sdxl": "endpoint-xyz" },
			fetchImpl,
		});

		const job = await client.getStatus(
			"rp-job-123",
			formatRunpodProviderEndpointId("endpoint-xyz")
		);

		expect(job).toMatchObject({
			endpointId: "runpod:endpoint-xyz",
			errorSummary: null,
			jobId: "rp-job-123",
			output: {
				images: [{ url: "https://assets.example.com/out.png" }],
			},
			progressPct: 100,
			status: "succeeded",
		});
	});

	it("adds data URLs for Fooocus base64 outputs", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						id: "rp-job-123",
						output: [{ base64: "iVBORw0KGgo=", finish_reason: "SUCCESS" }],
						status: "COMPLETED",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			)
		);
		const client = createRunpodClient({
			apiKey: "rpa_test_key",
			endpoints: { "fooocus-sdxl": "endpoint-xyz" },
			fetchImpl,
		});

		const job = await client.getStatus(
			"rp-job-123",
			formatRunpodProviderEndpointId("endpoint-xyz")
		);

		expect(job.output).toEqual([
			{
				base64: "iVBORw0KGgo=",
				dataUrl: "data:image/png;base64,iVBORw0KGgo=",
				finish_reason: "SUCCESS",
			},
		]);
	});

	it("surfaces failed RunPod status errors", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: { message: "Fooocus failed to load LoRA" },
						id: "rp-job-123",
						status: "FAILED",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			)
		);
		const client = createRunpodClient({
			apiKey: "rpa_test_key",
			endpoints: { "fooocus-sdxl": "endpoint-xyz" },
			fetchImpl,
		});

		const job = await client.getStatus(
			"rp-job-123",
			formatRunpodProviderEndpointId("endpoint-xyz")
		);

		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("Fooocus failed to load LoRA");
		expect(job.output).toBeNull();
	});

	it("cancels jobs through the decoded endpoint id", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://api.runpod.ai/v2/endpoint-xyz/cancel/rp-job-123"
			);
			expect(init?.method).toBe("POST");
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "rp-job-123",
						status: "CANCELLED",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createRunpodClient({
			apiKey: "rpa_test_key",
			endpoints: { "fooocus-sdxl": "endpoint-xyz" },
			fetchImpl,
		});

		await client.cancel(
			"rp-job-123",
			formatRunpodProviderEndpointId("endpoint-xyz")
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("throws when the endpoint key is not configured", async () => {
		const client = createRunpodClient({
			apiKey: "rpa_test_key",
			endpoints: {},
			fetchImpl: mock(() => Promise.reject(new Error("unexpected"))),
		});

		await expect(
			client.submit({
				__runpodEndpoint: "fooocus-sdxl",
				prompt: "test",
			})
		).rejects.toThrow("RunPod endpoint is not configured: fooocus-sdxl");
	});
});
