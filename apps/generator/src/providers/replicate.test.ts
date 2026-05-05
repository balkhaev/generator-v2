import { describe, expect, it, mock } from "bun:test";

import {
	createReplicateClient,
	formatReplicateProviderEndpointId,
	normalizeReplicateStatus,
} from "@/providers/replicate";

describe("replicate provider", () => {
	it("normalizes prediction statuses", () => {
		expect(normalizeReplicateStatus("starting")).toBe("queued");
		expect(normalizeReplicateStatus("processing")).toBe("running");
		expect(normalizeReplicateStatus("succeeded")).toBe("succeeded");
		expect(normalizeReplicateStatus("successful")).toBe("succeeded");
		expect(normalizeReplicateStatus("failed")).toBe("failed");
		expect(normalizeReplicateStatus("canceled")).toBe("failed");
		expect(() => normalizeReplicateStatus("unknown")).toThrow(
			"Unsupported Replicate status: unknown"
		);
	});

	it("creates async predictions and strips internal routing keys", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://api.replicate.com/v1/predictions");
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				authorization: "Bearer r8_test_key",
				"content-type": "application/json",
			});
			expect(JSON.parse(String(init?.body))).toEqual({
				input: {
					guidance_scale: 4,
					prompt: "test",
				},
				version: "mrhan1993/fooocus-api:version-id",
			});
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "prediction-123",
						status: "starting",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 201,
					}
				)
			);
		});
		const client = createReplicateClient({
			apiToken: "r8_test_key",
			fetchImpl,
		});

		const submission = await client.submit({
			__replicateVersion: "mrhan1993/fooocus-api:version-id",
			guidance_scale: 4,
			prompt: "test",
		});

		expect(submission).toEqual({
			endpointId: "replicate:mrhan1993/fooocus-api:version-id",
			jobId: "prediction-123",
			lastLogLine: null,
			progressPct: null,
			queuePosition: null,
			status: "queued",
		});
	});

	it("returns completed output from predictions.get", async () => {
		const fetchImpl = mock((url: string) => {
			expect(url).toBe(
				"https://api.replicate.com/v1/predictions/prediction-123"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "prediction-123",
						logs: "Loading model\nSampling complete",
						output: {
							paths: ["https://replicate.delivery/pbxt/result.png"],
							seeds: ["42"],
						},
						status: "succeeded",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createReplicateClient({
			apiToken: "r8_test_key",
			fetchImpl,
		});

		const job = await client.getStatus(
			"prediction-123",
			formatReplicateProviderEndpointId("mrhan1993/fooocus-api:version-id")
		);

		expect(job).toMatchObject({
			endpointId: "replicate:mrhan1993/fooocus-api:version-id",
			errorSummary: null,
			jobId: "prediction-123",
			lastLogLine: "Sampling complete",
			output: {
				paths: ["https://replicate.delivery/pbxt/result.png"],
				seeds: ["42"],
			},
			progressPct: 100,
			status: "succeeded",
		});
	});

	it("returns running status without output", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						id: "prediction-123",
						logs: "Starting up",
						output: ["https://example.com/incomplete.png"],
						status: "processing",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			)
		);
		const client = createReplicateClient({
			apiToken: "r8_test_key",
			fetchImpl,
		});

		const job = await client.getStatus(
			"prediction-123",
			formatReplicateProviderEndpointId("mrhan1993/fooocus-api:version-id")
		);

		expect(job.status).toBe("running");
		expect(job.output).toBeNull();
		expect(job.lastLogLine).toBe("Starting up");
	});

	it("surfaces failed prediction errors", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: { message: "Fooocus failed to load LoRA" },
						id: "prediction-123",
						status: "failed",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			)
		);
		const client = createReplicateClient({
			apiToken: "r8_test_key",
			fetchImpl,
		});

		const job = await client.getStatus(
			"prediction-123",
			formatReplicateProviderEndpointId("mrhan1993/fooocus-api:version-id")
		);

		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("Fooocus failed to load LoRA");
		expect(job.output).toBeNull();
	});

	it("throws on API errors with detail messages", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ detail: "Invalid API token" }), {
					headers: { "content-type": "application/json" },
					status: 401,
				})
			)
		);
		const client = createReplicateClient({
			apiToken: "bad_key",
			fetchImpl,
		});

		await expect(
			client.submit({
				__replicateVersion: "mrhan1993/fooocus-api:version-id",
				prompt: "test",
			})
		).rejects.toThrow("Replicate predictions.create: Invalid API token");
	});

	it("throws when __replicateVersion is missing from payload", async () => {
		const client = createReplicateClient({
			apiToken: "r8_test_key",
			fetchImpl: mock(() => {
				throw new Error("should not be called");
			}),
		});

		await expect(client.submit({ prompt: "test" })).rejects.toThrow(
			"Replicate provider requires __replicateVersion in payload"
		);
	});

	it("cancels predictions through the prediction id", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://api.replicate.com/v1/predictions/prediction-123/cancel"
			);
			expect(init?.method).toBe("POST");
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "prediction-123",
						status: "canceled",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createReplicateClient({
			apiToken: "r8_test_key",
			fetchImpl,
		});

		await client.cancel(
			"prediction-123",
			formatReplicateProviderEndpointId("mrhan1993/fooocus-api:version-id")
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
