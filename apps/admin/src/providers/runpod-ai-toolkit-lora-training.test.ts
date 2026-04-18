import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { RunpodAiToolkitLoraTrainingRunner } from "@/providers/runpod-ai-toolkit-lora-training";

interface FetchCall {
	body: unknown;
	method: string;
	url: string;
}

function createRunner(fetchImpl: typeof fetch) {
	return new RunpodAiToolkitLoraTrainingRunner({
		apiBaseUrl: "https://api.runpod.ai/v2",
		apiKey: "rpa_test_key",
		baseModel: "z-image",
		endpointId: "endpoint-xyz",
		falApiKeyForDataset: "fal-test",
		fetchImpl,
		logger: { error: () => undefined, info: () => undefined },
		personsApiBaseUrl: "https://persons-api.example.com",
		pollMs: 1,
		s3Config: {
			bucket: "lora-bucket",
			endpoint: "https://s3.example.com",
			publicBaseUrl: "https://assets.example.com",
			region: "us-east-1",
		} as never,
		trainingControlToken: "training-token",
		trainingTimeoutMs: 5000,
	});
}

interface RunnerInternals {
	getRunpodStatus: (jobId: string) => Promise<{
		error: string | null;
		output: unknown;
		rawStatus: string;
		status: string;
	}>;
	submitToRunpod: (input: Record<string, unknown>) => Promise<{
		jobId: string;
		rawStatus: string;
	}>;
}

const RUNPOD_RUN_503_PATTERN = /RunPod \/run failed \(503/;

describe("RunpodAiToolkitLoraTrainingRunner http contract", () => {
	const originalFetch = globalThis.fetch;
	const fetchCalls: FetchCall[] = [];

	beforeEach(() => {
		fetchCalls.length = 0;
		mock.restore();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		mock.restore();
	});

	it("submits payload to /run with bearer auth and serverless input wrapper", async () => {
		const fetchImpl = mock((input, init) => {
			const url = String(input);
			fetchCalls.push({
				body: init?.body
					? (JSON.parse(String(init.body)) as unknown)
					: undefined,
				method: (init?.method ?? "GET").toUpperCase(),
				url,
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
		}) as unknown as typeof fetch;

		const runner = createRunner(fetchImpl);
		const internals = runner as unknown as RunnerInternals;
		const result = await internals.submitToRunpod({
			base_model: "z-image",
			dataset_url: "https://assets.example.com/dataset.zip",
			default_caption: "a photo of ohwx_one",
			learning_rate: 0.0001,
			lora_rank: 16,
			output_name: "one-runpod-lora-1",
			training_steps: 100,
			trigger_word: "ohwx_one",
		});

		expect(result.jobId).toBe("rp-job-123");
		expect(result.rawStatus).toBe("IN_QUEUE");
		expect(fetchCalls).toHaveLength(1);
		const call = fetchCalls[0];
		if (!call) {
			throw new Error("Expected fetch call to be captured");
		}
		expect(call.url).toBe("https://api.runpod.ai/v2/endpoint-xyz/run");
		expect(call.method).toBe("POST");
		expect(call.body).toMatchObject({
			input: {
				base_model: "z-image",
				dataset_url: "https://assets.example.com/dataset.zip",
				training_steps: 100,
				trigger_word: "ohwx_one",
			},
		});
	});

	it("normalizes RunPod status payload and surfaces serverless errors", async () => {
		const responses: Array<{ body: Record<string, unknown>; status: number }> =
			[
				{
					body: { id: "rp-job-1", status: "IN_PROGRESS" },
					status: 200,
				},
				{
					body: {
						error: "GPU OOM during step 87",
						id: "rp-job-1",
						status: "FAILED",
					},
					status: 200,
				},
			];

		let callIndex = 0;
		const fetchImpl = mock(() => {
			const item = responses[callIndex++];
			if (!item) {
				return Promise.reject(new Error("Unexpected fetch call"));
			}
			return Promise.resolve(
				new Response(JSON.stringify(item.body), {
					headers: { "content-type": "application/json" },
					status: item.status,
				})
			);
		}) as unknown as typeof fetch;

		const runner = createRunner(fetchImpl);
		const internals = runner as unknown as RunnerInternals;

		const inProgress = await internals.getRunpodStatus("rp-job-1");
		expect(inProgress.status).toBe("running");
		expect(inProgress.rawStatus).toBe("IN_PROGRESS");
		expect(inProgress.error).toBeNull();

		const failed = await internals.getRunpodStatus("rp-job-1");
		expect(failed.status).toBe("failed");
		expect(failed.error).toBe("GPU OOM during step 87");
	});

	it("surfaces detailed message when /run rejects with non-2xx", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: "endpoint not ready" }), {
					headers: { "content-type": "application/json" },
					status: 503,
				})
			)
		) as unknown as typeof fetch;

		const runner = createRunner(fetchImpl);
		const internals = runner as unknown as RunnerInternals;
		await expect(
			internals.submitToRunpod({ dataset_url: "x" })
		).rejects.toThrow(RUNPOD_RUN_503_PATTERN);
	});
});
