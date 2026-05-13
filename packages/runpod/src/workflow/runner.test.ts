import { describe, expect, it, mock } from "bun:test";
import type { S3StorageConfig } from "@generator/storage";
import { z } from "zod";

import type { PodWorkflow, ServerlessWorkflow } from "./definition";
import { createRunpodService } from "./runner";

const NO_WORKFLOW_MATCH_PATTERN = /No RunPod workflow matches/;

const s3: S3StorageConfig = {
	accessKeyId: "access",
	bucket: "assets",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "hel1",
	secretAccessKey: "secret",
};

const fooocusInputSchema = z.object({ prompt: z.string() });

type FooocusInput = z.infer<typeof fooocusInputSchema>;

function fooocusServerless(
	endpointId: string
): ServerlessWorkflow<FooocusInput, unknown> {
	return {
		id: "fooocus-sdxl",
		mode: "serverless",
		endpointId,
		inputSchema: fooocusInputSchema,
		buildPayload: (input) => ({ prompt: input.prompt }),
		parseOutput: (raw) => raw,
	};
}

function rawSubmissionResponse(): Record<string, unknown> {
	return { id: "job-1", status: "IN_QUEUE" };
}

describe("RunpodService routing", () => {
	it("routes by workflowId and emits canonical endpointId", async () => {
		const fetchImpl = mock((url: string) => {
			if (url.endsWith("/run")) {
				return Promise.resolve(Response.json(rawSubmissionResponse()));
			}
			return Promise.resolve(Response.json({}));
		});

		const service = createRunpodService({
			apiKey: "rpa_test",
			fetchImpl,
			s3,
			workflows: [fooocusServerless("endpoint-x")],
		});

		const result = await service.submit({
			input: { prompt: "hi" },
			workflowId: "fooocus-sdxl",
		});

		expect(result).toEqual({
			endpointId: "runpod:fooocus-sdxl",
			jobId: "job-1",
			queuePosition: null,
			status: "queued",
			workflowId: "fooocus-sdxl",
		});
	});

	it("resolves legacy serverless endpointId by raw RunPod endpoint id", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				Response.json({
					id: "job-1",
					status: "COMPLETED",
					output: { ok: true },
				})
			)
		);

		const service = createRunpodService({
			apiKey: "rpa_test",
			fetchImpl,
			s3,
			workflows: [fooocusServerless("old-endpoint-id")],
		});

		const job = await service.getStatus({
			endpointId: "runpod:old-endpoint-id",
			jobId: "job-1",
		});

		expect(job.workflowId).toBe("fooocus-sdxl");
		expect(job.endpointId).toBe("runpod:fooocus-sdxl");
		expect(job.status).toBe("succeeded");
	});

	it("resolves legacy pod endpointId via the `runpod-pod:` prefix", async () => {
		const fetchImpl = mock((_url: string, init?: RequestInit) => {
			if (init?.method === "DELETE") {
				return Promise.resolve(new Response(null, { status: 204 }));
			}
			return Promise.resolve(Response.json({ id: "pod-1" }));
		});

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
				templateId: "tpl-x",
			},
			inputSchema: z.object({ prompt: z.string() }),
			artifactContentType: "video/mp4",
			buildPrompt: () => ({ prompt: {} }),
			parseOutput: () => ({}),
		};

		const service = createRunpodService({
			apiKey: "rpa_test",
			fetchImpl,
			s3,
			workflows: [ltxWorkflow],
		});

		await service.cancel({
			endpointId: "runpod-pod:ltx-2-3-video",
			jobId: "pod-1:req-1:pwd-1",
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("rejects unrecognised endpointIds with a list of known workflows", async () => {
		const service = createRunpodService({
			apiKey: "rpa_test",
			fetchImpl: mock(() => Promise.reject(new Error("noop"))),
			s3,
			workflows: [fooocusServerless("endpoint-x")],
		});

		await expect(
			service.cancel({ endpointId: "fal:foo", jobId: "x" })
		).rejects.toThrow("Unrecognised RunPod endpointId");
		await expect(
			service.cancel({ endpointId: "runpod:unknown-id", jobId: "x" })
		).rejects.toThrow(NO_WORKFLOW_MATCH_PATTERN);
	});
});
