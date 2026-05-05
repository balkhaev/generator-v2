import { describe, expect, it, mock } from "bun:test";

import {
	createCivitaiClient,
	formatCivitaiProviderEndpointId,
	parseCivitaiProviderEndpointId,
} from "@/providers/civitai";

const LUSTIFY_MODEL = "urn:air:sdxl:checkpoint:civitai:573152@1569593";

describe("civitai provider", () => {
	it("submits text-to-image jobs to Civitai orchestration", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://orchestration.civitai.com/v1/consumer/jobs?detailed=false&wait=false"
			);
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				authorization: "Bearer civitai_test_key",
				"content-type": "application/json",
			});
			expect(JSON.parse(String(init?.body))).toEqual({
				$type: "textToImage",
				baseModel: "SDXL",
				model: LUSTIFY_MODEL,
				params: {
					cfgScale: 3.5,
					height: 1216,
					prompt: "test",
					scheduler: "DPM2MKarras",
					steps: 30,
					width: 832,
				},
				quantity: 1,
			});
			return Promise.resolve(
				new Response(
					JSON.stringify({
						jobs: [
							{
								jobId: "job-1",
								result: { available: false },
								scheduled: true,
							},
						],
						token: "token-123",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl,
		});

		const submission = await client.submit({
			__civitaiModel: LUSTIFY_MODEL,
			$type: "textToImage",
			baseModel: "SDXL",
			params: {
				cfgScale: 3.5,
				height: 1216,
				prompt: "test",
				scheduler: "DPM2MKarras",
				steps: 30,
				width: 832,
			},
			quantity: 1,
		});

		expect(submission).toEqual({
			endpointId: `civitai:${LUSTIFY_MODEL}`,
			jobId: "token-123",
			lastLogLine: null,
			progressPct: null,
			queuePosition: null,
			status: "running",
		});
	});

	it("submits generic video jobs without injecting a top-level model", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://orchestration.civitai.com/v1/consumer/jobs?detailed=false&wait=false"
			);
			expect(init?.method).toBe("POST");
			expect(JSON.parse(String(init?.body))).toEqual({
				$type: "videoGen",
				input: {
					engine: "ltx2.3",
					operation: "createVideo",
					prompt: "test",
					loras: {
						"urn:air:ltxv23:lora:civitai:2509189@2820451": 1,
					},
				},
			});
			return Promise.resolve(
				new Response(
					JSON.stringify({
						jobs: [{ jobId: "job-1", scheduled: true }],
						token: "token-123",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl,
		});

		const submission = await client.submit({
			__civitaiEndpoint: "ltx2.3:synth-lora:createVideo",
			$type: "videoGen",
			input: {
				engine: "ltx2.3",
				operation: "createVideo",
				prompt: "test",
				loras: {
					"urn:air:ltxv23:lora:civitai:2509189@2820451": 1,
				},
			},
		});

		expect(submission.endpointId).toBe("civitai:ltx2.3:synth-lora:createVideo");
	});

	it("returns completed blob URLs from token status", async () => {
		const fetchImpl = mock((url: string) => {
			expect(url).toBe(
				"https://orchestration.civitai.com/v1/consumer/jobs?detailed=false&token=token-123&wait=false"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						jobs: [
							{
								jobId: "job-1",
								lastEvent: { type: "Succeeded" },
								result: {
									available: true,
									blobUrl: "https://blobs-temp.civitai.com/result.png",
								},
								scheduled: false,
							},
						],
						token: "token-123",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			);
		});
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl,
		});

		const job = await client.getStatus(
			"token-123",
			formatCivitaiProviderEndpointId(LUSTIFY_MODEL)
		);

		expect(job).toMatchObject({
			endpointId: `civitai:${LUSTIFY_MODEL}`,
			errorSummary: null,
			jobId: "token-123",
			lastLogLine: "Civitai Succeeded",
			output: {
				jobs: [
					{
						result: {
							blobUrl: "https://blobs-temp.civitai.com/result.png",
						},
					},
				],
			},
			progressPct: 100,
			status: "succeeded",
		});
	});

	it("surfaces failed job events", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						jobs: [
							{
								jobId: "job-1",
								lastEvent: {
									context: { message: "Model is unavailable" },
									type: "Failed",
								},
								result: { available: false },
								scheduled: false,
							},
						],
						token: "token-123",
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					}
				)
			)
		);
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl,
		});

		const job = await client.getStatus(
			"token-123",
			formatCivitaiProviderEndpointId(LUSTIFY_MODEL)
		);

		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("Model is unavailable");
		expect(job.output).toBeNull();
	});

	it("cancels jobs by token", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://orchestration.civitai.com/v1/consumer/jobs?force=true&token=token-123"
			);
			expect(init?.method).toBe("DELETE");
			return Promise.resolve(new Response(null, { status: 204 }));
		});
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl,
		});

		await client.cancel(
			"token-123",
			formatCivitaiProviderEndpointId(LUSTIFY_MODEL)
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("throws when Civitai routing metadata is missing from payload", async () => {
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl: mock(() => {
				throw new Error("should not be called");
			}),
		});

		await expect(client.submit({ prompt: "test" })).rejects.toThrow(
			"Civitai provider requires __civitaiModel or __civitaiEndpoint in payload"
		);
	});

	it("parses provider endpoint IDs", () => {
		const endpointId = formatCivitaiProviderEndpointId(LUSTIFY_MODEL);
		expect(endpointId).toBe(`civitai:${LUSTIFY_MODEL}`);
		expect(parseCivitaiProviderEndpointId(endpointId)).toBe(LUSTIFY_MODEL);
		expect(() => parseCivitaiProviderEndpointId("fal-ai/model")).toThrow(
			"Civitai provider requires a civitai-prefixed endpointId"
		);
	});
});
