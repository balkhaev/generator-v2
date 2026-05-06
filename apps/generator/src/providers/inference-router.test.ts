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
	it("routes Civitai-marked payloads and endpoint ids to Civitai", async () => {
		const civitai = createMockClient("civitai");
		const fal = createMockClient("fal");
		const router = createInferenceRouter({ civitai, fal });

		await expect(
			router.submit({
				__civitaiModel: "urn:air:sdxl:checkpoint:civitai:573152@1569593",
				prompt: "test",
			})
		).resolves.toMatchObject({
			endpointId: "civitai-endpoint",
		});
		expect(civitai.submit).toHaveBeenCalledTimes(1);
		expect(fal.submit).not.toHaveBeenCalled();

		await router.getStatus(
			"civitai-token-1",
			"civitai:urn:air:sdxl:checkpoint:civitai:573152@1569593"
		);
		expect(civitai.getStatus).toHaveBeenCalledWith(
			"civitai-token-1",
			"civitai:urn:air:sdxl:checkpoint:civitai:573152@1569593"
		);

		await router.cancel(
			"civitai-token-1",
			"civitai:urn:air:sdxl:checkpoint:civitai:573152@1569593"
		);
		expect(civitai.cancel).toHaveBeenCalledWith(
			"civitai-token-1",
			"civitai:urn:air:sdxl:checkpoint:civitai:573152@1569593"
		);

		await router.submit({
			__civitaiEndpoint: "ltx2.3:synth-lora:createVideo",
			$type: "videoGen",
			input: { prompt: "test" },
		});
		expect(civitai.submit).toHaveBeenCalledTimes(2);
	});

	it("routes new __runpodWorkflow payloads to the RunPod adapter", async () => {
		const fal = createMockClient("fal");
		const runpod = createMockClient("runpod");
		const router = createInferenceRouter({ fal, runpod });

		await expect(
			router.submit({
				__runpodWorkflow: "fooocus-sdxl",
				prompt: "test",
			})
		).resolves.toMatchObject({ endpointId: "runpod-endpoint" });
		expect(runpod.submit).toHaveBeenCalledTimes(1);
		expect(fal.submit).not.toHaveBeenCalled();
	});

	it("routes legacy __runpodEndpoint and __runpodPod payloads to RunPod", async () => {
		const fal = createMockClient("fal");
		const runpod = createMockClient("runpod");
		const router = createInferenceRouter({ fal, runpod });

		await router.submit({
			__runpodEndpoint: "fooocus-sdxl",
			prompt: "test",
		});
		await router.submit({
			__runpodPod: "ltx-2-3-video",
			prompt: "test",
		});
		expect(runpod.submit).toHaveBeenCalledTimes(2);
	});

	it("routes runpod: and runpod-pod: endpoint ids to the same adapter", async () => {
		const fal = createMockClient("fal");
		const runpod = createMockClient("runpod");
		const router = createInferenceRouter({ fal, runpod });

		await router.getStatus("rp-job-1", "runpod:fooocus-sdxl");
		await router.getStatus("pod-1:req-1", "runpod-pod:ltx-2-3-video");
		await router.cancel("rp-job-1", "runpod:fooocus-sdxl");
		await router.cancel("pod-1:req-1", "runpod-pod:ltx-2-3-video");
		expect(runpod.getStatus).toHaveBeenCalledTimes(2);
		expect(runpod.cancel).toHaveBeenCalledTimes(2);
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

	it("routes Replicate-marked payloads and endpoint ids to Replicate", async () => {
		const fal = createMockClient("fal");
		const replicate = createMockClient("replicate");
		const router = createInferenceRouter({ fal, replicate });

		await expect(
			router.submit({
				__replicateVersion: "mrhan1993/fooocus-api:version-id",
				prompt: "test",
			})
		).resolves.toMatchObject({
			endpointId: "replicate-endpoint",
		});
		expect(replicate.submit).toHaveBeenCalledTimes(1);
		expect(fal.submit).not.toHaveBeenCalled();

		await router.getStatus(
			"replicate-job-1",
			"replicate:mrhan1993/fooocus-api:version-id"
		);
		expect(replicate.getStatus).toHaveBeenCalledWith(
			"replicate-job-1",
			"replicate:mrhan1993/fooocus-api:version-id"
		);

		await router.cancel(
			"replicate-job-1",
			"replicate:mrhan1993/fooocus-api:version-id"
		);
		expect(replicate.cancel).toHaveBeenCalledWith(
			"replicate-job-1",
			"replicate:mrhan1993/fooocus-api:version-id"
		);
	});

	it("fails fast when a RunPod workflow is submitted without a RunPod client", () => {
		const router = createInferenceRouter({ fal: createMockClient("fal") });

		expect(() =>
			router.submit({
				__runpodWorkflow: "fooocus-sdxl",
				prompt: "test",
			})
		).toThrow("RunPod inference client is not configured");
		expect(() =>
			router.submit({
				__runpodPod: "ltx-2-3-video",
				prompt: "test",
			})
		).toThrow("RunPod inference client is not configured");
	});

	it("fails fast when a Civitai workflow is submitted without a Civitai client", () => {
		const router = createInferenceRouter({ fal: createMockClient("fal") });

		expect(() =>
			router.submit({
				__civitaiModel: "urn:air:sdxl:checkpoint:civitai:573152@1569593",
				prompt: "test",
			})
		).toThrow("Civitai inference client is not configured");
		expect(() =>
			router.submit({
				__civitaiEndpoint: "ltx2.3:synth-lora:createVideo",
				prompt: "test",
			})
		).toThrow("Civitai inference client is not configured");
	});

	it("fails fast when a Replicate workflow is submitted without a Replicate client", () => {
		const router = createInferenceRouter({ fal: createMockClient("fal") });

		expect(() =>
			router.submit({
				__replicateVersion: "mrhan1993/fooocus-api:version-id",
				prompt: "test",
			})
		).toThrow("Replicate inference client is not configured");
	});
});
