import { describe, expect, it, mock } from "bun:test";

import type { InferenceClient } from "@/providers/inference";
import { createInferenceRouter } from "@/providers/inference-router";

function createMockClient(label: string): InferenceClient {
	return {
		cancel: mock(async () => undefined),
		getStatus: mock(async (jobId: string, endpointId?: string) => ({
			endpointId: endpointId ?? `${label}-endpoint`,
			errorSummary: null,
			jobId,
			output: null,
			status: "running" as const,
		})),
		submit: mock(async () => ({
			endpointId: `${label}-endpoint`,
			jobId: `${label}-job`,
			status: "queued" as const,
		})),
	};
}

describe("inference router", () => {
	it("routes RunPod-marked payloads and endpoint ids to RunPod", async () => {
		const fal = createMockClient("fal");
		const runpod = createMockClient("runpod");
		const router = createInferenceRouter({ fal, runpod });

		await expect(
			router.submit({
				__runpodEndpoint: "fooocus-sdxl",
				prompt: "test",
			})
		).resolves.toMatchObject({
			endpointId: "runpod-endpoint",
		});
		expect(runpod.submit).toHaveBeenCalledTimes(1);
		expect(fal.submit).not.toHaveBeenCalled();

		await router.getStatus("rp-job-1", "runpod:endpoint-xyz");
		expect(runpod.getStatus).toHaveBeenCalledWith(
			"rp-job-1",
			"runpod:endpoint-xyz"
		);

		await router.cancel("rp-job-1", "runpod:endpoint-xyz");
		expect(runpod.cancel).toHaveBeenCalledWith(
			"rp-job-1",
			"runpod:endpoint-xyz"
		);
	});

	it("keeps fal routing for fal payloads and unprefixed endpoint ids", async () => {
		const fal = createMockClient("fal");
		const runpod = createMockClient("runpod");
		const router = createInferenceRouter({ fal, runpod });

		await router.submit({
			__falModel: "fal-ai/fast-sdxl",
			prompt: "test",
		});
		expect(fal.submit).toHaveBeenCalledTimes(1);
		expect(runpod.submit).not.toHaveBeenCalled();

		await router.getStatus("fal-job-1", "fal-ai/fast-sdxl");
		expect(fal.getStatus).toHaveBeenCalledWith("fal-job-1", "fal-ai/fast-sdxl");
	});

	it("fails fast when a RunPod workflow is submitted without a RunPod client", () => {
		const router = createInferenceRouter({ fal: createMockClient("fal") });

		expect(() =>
			router.submit({
				__runpodEndpoint: "fooocus-sdxl",
				prompt: "test",
			})
		).toThrow("RunPod inference client is not configured");
	});
});
