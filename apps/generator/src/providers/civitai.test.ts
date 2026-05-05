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
				"https://orchestration-new.civitai.com/v1/consumer/jobs?detailed=false&wait=false"
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
		const expectedBody = {
			allowMatureContent: true,
			currencies: [],
			metadata: {
				endpointKey: "ltx2.3:synth-lora:createVideo",
				source: "generator",
			},
			steps: [
				{
					$type: "videoGen",
					input: {
						engine: "ltx2.3",
						operation: "createVideo",
						prompt: "test",
						loras: {
							"urn:air:ltxv23:lora:civitai:2509189@2820451": 1,
						},
					},
					name: "video",
					priority: "normal",
					retries: 1,
				},
			],
		};
		let requestIndex = 0;
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			requestIndex += 1;
			expect(init?.method).toBe("POST");
			expect(JSON.parse(String(init?.body))).toEqual(expectedBody);
			if (requestIndex === 1) {
				expect(url).toBe(
					"https://orchestration-new.civitai.com/v2/consumer/workflows?hideMatureContent=false&wait=0&whatif=true"
				);
				return Promise.resolve(
					new Response(
						JSON.stringify({
							id: "workflow-estimate",
							status: "scheduled",
							steps: [
								{
									jobs: [
										{
											id: "job-estimate",
											queuePosition: {
												precedingJobs: 2,
												support: "available",
											},
											status: "scheduled",
										},
									],
									name: "video",
									status: "scheduled",
								},
							],
						}),
						{
							headers: { "content-type": "application/json" },
							status: 200,
						}
					)
				);
			}
			expect(url).toBe(
				"https://orchestration-new.civitai.com/v2/consumer/workflows?hideMatureContent=false&wait=0"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "workflow-123",
						status: "scheduled",
						steps: [
							{
								jobs: [
									{
										id: "job-1",
										queuePosition: { precedingJobs: 2 },
										status: "scheduled",
									},
								],
								name: "video",
								status: "scheduled",
							},
						],
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

		expect(submission).toEqual({
			endpointId: "civitai:ltx2.3:synth-lora:createVideo",
			jobId: "workflow-123",
			lastLogLine: "Civitai workflow scheduled",
			progressPct: null,
			queuePosition: 2,
			status: "queued",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("fails fast when workflow preflight has no supporting provider", async () => {
		const fetchImpl = mock((url: string) => {
			expect(url).toBe(
				"https://orchestration-new.civitai.com/v2/consumer/workflows?hideMatureContent=false&wait=0&whatif=true"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "workflow-estimate",
						status: "unassigned",
						steps: [
							{
								jobs: [
									{
										id: "job-estimate",
										status: "unassigned",
									},
								],
								name: "video",
								status: "unassigned",
							},
						],
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

		await expect(
			client.submit({
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
			})
		).rejects.toThrow(
			"Civitai workflows.preflight: Civitai has no available provider for this LTX 2.3 step video. The selected LoRA/model combination is not currently supported by Civitai inference."
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("returns completed blob URLs from token status", async () => {
		const fetchImpl = mock((url: string) => {
			expect(url).toBe(
				"https://orchestration-new.civitai.com/v1/consumer/jobs?detailed=false&token=token-123&wait=false"
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

	it("returns completed video URLs from workflow status", async () => {
		const fetchImpl = mock((url: string) => {
			expect(url).toBe(
				"https://orchestration-new.civitai.com/v2/consumer/workflows/workflow-123?hideMatureContent=false&wait=false"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "workflow-123",
						status: "succeeded",
						steps: [
							{
								$type: "videoGen",
								name: "video",
								output: {
									video: {
										available: true,
										id: "video-1",
										type: "video",
										url: "https://blobs-temp.civitai.com/result.mp4",
									},
								},
								status: "succeeded",
							},
						],
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
			"workflow-123",
			"civitai:ltx2.3:synth-lora:createVideo"
		);

		expect(job).toMatchObject({
			endpointId: "civitai:ltx2.3:synth-lora:createVideo",
			errorSummary: null,
			jobId: "workflow-123",
			lastLogLine: "Civitai workflow succeeded",
			output: {
				steps: [
					{
						output: {
							video: {
								url: "https://blobs-temp.civitai.com/result.mp4",
							},
						},
					},
				],
			},
			progressPct: 100,
			status: "succeeded",
		});
	});

	it("surfaces detailed failed workflow job reasons", async () => {
		let requestIndex = 0;
		const fetchImpl = mock((url: string) => {
			requestIndex += 1;
			if (requestIndex === 1) {
				expect(url).toBe(
					"https://orchestration-new.civitai.com/v2/consumer/workflows/workflow-123?hideMatureContent=false&wait=false"
				);
				return Promise.resolve(
					new Response(
						JSON.stringify({
							id: "workflow-123",
							status: "failed",
							steps: [
								{
									jobs: [
										{
											id: "provider-job-1",
											status: "failed",
										},
									],
									name: "video",
									status: "failed",
								},
							],
						}),
						{
							headers: { "content-type": "application/json" },
							status: 200,
						}
					)
				);
			}
			expect(url).toBe(
				"https://orchestration-new.civitai.com/v1/consumer/jobs/provider-job-1?detailed=true"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						jobId: "provider-job-1",
						lastEvent: {
							context: { reason: "No provider supports this job" },
							type: "Failed",
						},
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
			"workflow-123",
			"civitai:ltx2.3:synth-lora:createVideo"
		);

		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("No provider supports this job");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
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
				"https://orchestration-new.civitai.com/v1/consumer/jobs?force=true&token=token-123"
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

	it("cancels workflows by id", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://orchestration-new.civitai.com/v2/consumer/workflows/workflow-123"
			);
			expect(init?.method).toBe("DELETE");
			return Promise.resolve(new Response(null, { status: 204 }));
		});
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl,
		});

		await client.cancel(
			"workflow-123",
			"civitai:ltx2.3:synth-lora:createVideo"
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

	it("includes Civitai validation fields in submit errors", async () => {
		const client = createCivitaiClient({
			apiKey: "civitai_test_key",
			fetchImpl: mock(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							errors: {
								"input.duration": ["The value 5 is not valid for Duration."],
							},
							title: "One or more validation errors occurred.",
						}),
						{
							headers: { "content-type": "application/json" },
							status: 400,
						}
					)
				)
			),
		});

		await expect(
			client.submit({
				__civitaiEndpoint: "ltx2.3:synth-lora:createVideo",
				$type: "videoGen",
				input: {
					duration: 5,
					engine: "ltx2.3",
					operation: "createVideo",
					prompt: "test",
				},
			})
		).rejects.toThrow(
			"Civitai workflows.preflight: One or more validation errors occurred. input.duration: The value 5 is not valid for Duration."
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
