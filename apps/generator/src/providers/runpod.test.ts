import { describe, expect, it, mock } from "bun:test";
import {
	createFooocusSdxlWorkflow,
	createRunpodService,
	type PodWorkflow,
} from "@generator/runpod";
import type { S3StorageConfig } from "@generator/storage";
import { z } from "zod";

import {
	isRetryableInferenceError,
	RetryableInferenceError,
} from "@/providers/inference";
import {
	createRunpodClient,
	isRunpodEndpointId,
	isRunpodPayload,
	RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY,
	RUNPOD_LEGACY_POD_PAYLOAD_KEY,
	RUNPOD_WORKFLOW_PAYLOAD_KEY,
} from "@/providers/runpod";

const s3: S3StorageConfig = {
	accessKeyId: "access",
	bucket: "assets",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "hel1",
	secretAccessKey: "secret",
};

const ltxWorkflow: PodWorkflow<{ prompt: string }, unknown> = {
	id: "ltx-2-3-video",
	mode: "pod",
	pod: {
		imageName: "img:latest",
		networkVolumes: [
			{
				gpuTypeIds: ["A6000"],
				label: "test-dc",
				networkVolumeId: "vol-test",
			},
		],
		templateId: "p4f6rm9tb4",
	},
	inputSchema: z.object({ prompt: z.string() }),
	artifactContentType: "video/mp4",
	buildEnv: () => ({}),
	buildPrompt: () => ({ prompt: {} }),
	parseOutput: () => ({}),
};

function buildService(fetchImpl: ReturnType<typeof mock>) {
	return createRunpodService({
		apiKey: "rpa_test",
		fetchImpl,
		s3,
		workflows: [
			createFooocusSdxlWorkflow({ endpointId: "endpoint-x" }),
			ltxWorkflow,
		],
	});
}

describe("RunPod adapter", () => {
	it("submits using the canonical __runpodWorkflow marker", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(Response.json({ id: "job-1", status: "IN_QUEUE" }))
		);
		const adapter = createRunpodClient(buildService(fetchImpl));

		const result = await adapter.submit({
			[RUNPOD_WORKFLOW_PAYLOAD_KEY]: "fooocus-sdxl",
			prompt: "test",
		});
		expect(result).toEqual({
			endpointId: "runpod:fooocus-sdxl",
			jobId: "job-1",
			queuePosition: null,
			status: "queued",
		});
	});

	it("treats legacy __runpodEndpoint as workflowId fallback", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(Response.json({ id: "job-1", status: "IN_QUEUE" }))
		);
		const adapter = createRunpodClient(buildService(fetchImpl));

		const result = await adapter.submit({
			[RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY]: "fooocus-sdxl",
			prompt: "test",
		});
		expect(result.endpointId).toBe("runpod:fooocus-sdxl");
	});

	it("treats legacy __runpodEndpoint with raw RunPod endpoint id", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(Response.json({ id: "job-1", status: "IN_QUEUE" }))
		);
		const adapter = createRunpodClient(buildService(fetchImpl));

		const result = await adapter.submit({
			[RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY]: "endpoint-x",
			prompt: "test",
		});
		expect(result.endpointId).toBe("runpod:fooocus-sdxl");
	});

	it("uses __runpodPod for legacy pod workflows", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(Response.json({ id: "pod-1", desiredStatus: "RUNNING" }))
		);
		const adapter = createRunpodClient(buildService(fetchImpl));

		const result = await adapter.submit({
			[RUNPOD_LEGACY_POD_PAYLOAD_KEY]: "ltx-2-3-video",
			prompt: "test",
		});
		expect(result.endpointId).toBe("runpod:ltx-2-3-video");
		expect(result.status).toBe("queued");
	});

	it("strips routing markers before passing input to the engine", async () => {
		const fetchImpl = mock((_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			expect(body.input).not.toHaveProperty(RUNPOD_WORKFLOW_PAYLOAD_KEY);
			expect(body.input).toHaveProperty("prompt", "hi");
			return Promise.resolve(
				Response.json({ id: "job-1", status: "IN_QUEUE" })
			);
		});
		const adapter = createRunpodClient(buildService(fetchImpl));

		await adapter.submit({
			[RUNPOD_WORKFLOW_PAYLOAD_KEY]: "fooocus-sdxl",
			prompt: "hi",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("propagates getStatus and cancel through the service", async () => {
		const calls: string[] = [];
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			calls.push(`${init?.method ?? "GET"} ${url}`);
			if (url.includes("/cancel/")) {
				return Promise.resolve(Response.json({ id: "job-1" }));
			}
			return Promise.resolve(
				Response.json({
					id: "job-1",
					status: "COMPLETED",
					output: [{ url: "https://x/y.png" }],
				})
			);
		});
		const adapter = createRunpodClient(buildService(fetchImpl));

		const job = await adapter.getStatus("job-1", "runpod:fooocus-sdxl");
		expect(job.status).toBe("succeeded");
		expect(job.endpointId).toBe("runpod:fooocus-sdxl");
		expect(job.output).toBeDefined();

		await adapter.cancel("job-1", "runpod:fooocus-sdxl");
		expect(calls).toEqual([
			"GET https://api.runpod.ai/v2/endpoint-x/status/job-1",
			"POST https://api.runpod.ai/v2/endpoint-x/cancel/job-1",
		]);
	});

	it("rejects payloads without any RunPod marker", async () => {
		const adapter = createRunpodClient(
			buildService(mock(() => Promise.reject(new Error("noop"))))
		);
		await expect(adapter.submit({ prompt: "test" })).rejects.toThrow(
			"RunPod payload requires"
		);
	});

	it("translates RunPod no-capacity error into RetryableInferenceError", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: "There are no instances currently available",
					}),
					{ status: 500, headers: { "content-type": "application/json" } }
				)
			)
		);
		const adapter = createRunpodClient(buildService(fetchImpl));
		let caught: unknown;
		try {
			await adapter.submit({
				[RUNPOD_LEGACY_POD_PAYLOAD_KEY]: "ltx-2-3-video",
				prompt: "test",
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(RetryableInferenceError);
		expect(isRetryableInferenceError(caught)).toBe(true);
		if (isRetryableInferenceError(caught)) {
			expect(caught.delayMs).toBeGreaterThan(0);
			expect(caught.maxWindowMs).toBeGreaterThanOrEqual(caught.delayMs);
		}
	});
});

describe("RunPod payload markers", () => {
	it("isRunpodPayload covers all three markers", () => {
		expect(isRunpodPayload({ [RUNPOD_WORKFLOW_PAYLOAD_KEY]: "x" })).toBe(true);
		expect(isRunpodPayload({ [RUNPOD_LEGACY_ENDPOINT_PAYLOAD_KEY]: "x" })).toBe(
			true
		);
		expect(isRunpodPayload({ [RUNPOD_LEGACY_POD_PAYLOAD_KEY]: "x" })).toBe(
			true
		);
		expect(isRunpodPayload({ prompt: "x" })).toBe(false);
	});

	it("isRunpodEndpointId recognises both prefixes", () => {
		expect(isRunpodEndpointId("runpod:fooocus-sdxl")).toBe(true);
		expect(isRunpodEndpointId("runpod-pod:ltx-2-3-video")).toBe(true);
		expect(isRunpodEndpointId("fal-ai/foo")).toBe(false);
		expect(isRunpodEndpointId(undefined)).toBe(false);
	});
});
