import { describe, expect, it, mock } from "bun:test";
import type { S3ObjectStat, S3StorageConfig } from "@generator/storage";
import { z } from "zod";

import type { PodSnapshot, RunpodPodsApi } from "../api/pods";
import type { PodWorkflow } from "../workflow/definition";
import { createPodEngine, formatPodJobId, parsePodJobId } from "./pod-engine";

const s3: S3StorageConfig = {
	accessKeyId: "access",
	bucket: "assets",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "hel1",
	secretAccessKey: "secret",
};

const ltxInputSchema = z.object({
	prompt: z.string(),
});

interface VideoOutput {
	logUrl: string;
	podId: string;
	videoUrl: string;
}

const ltxWorkflow: PodWorkflow<z.infer<typeof ltxInputSchema>, VideoOutput> = {
	id: "ltx-2-3-video",
	mode: "pod",
	pod: {
		bootstrapUrl: "https://cdn.example.com/pod-bootstrap.sh",
		gpuTypeIds: ["NVIDIA RTX A6000"],
		imageName: "runpod/pytorch:test",
		namePrefix: "ltx23",
	},
	inputSchema: ltxInputSchema,
	artifactContentType: "video/mp4",
	buildEnv(input, ctx) {
		return {
			LOG_UPLOAD_URL: ctx.logUploadUrl,
			OUTPUT_UPLOAD_URL: ctx.outputUploadUrl,
			PROMPT: input.prompt,
			REQUEST_ID: ctx.requestId,
		};
	},
	parseOutput(ctx) {
		return {
			logUrl: ctx.logPublicUrl,
			podId: ctx.podId,
			videoUrl: ctx.outputPublicUrl,
		};
	},
};

function buildApi(overrides: Partial<RunpodPodsApi> = {}): RunpodPodsApi {
	return {
		create:
			overrides.create ??
			mock(() => Promise.resolve<PodSnapshot>({ id: "pod-1" })),
		delete: overrides.delete ?? mock(() => Promise.resolve()),
		get:
			overrides.get ??
			mock(() => Promise.resolve<PodSnapshot>({ id: "pod-1" })),
	};
}

function makeStat(key: string, sizeBytes: number): S3ObjectStat {
	return {
		etag: "etag",
		key,
		lastModified: new Date(),
		sizeBytes,
		type: "video/mp4",
		url: `https://assets.example.com/${key}`,
	};
}

describe("podJobId helpers", () => {
	it("formats and parses pod job ids", () => {
		expect(formatPodJobId({ podId: "pod-1", requestId: "req-1" })).toBe(
			"pod-1:req-1"
		);
		expect(parsePodJobId("pod-1:req-1")).toEqual({
			podId: "pod-1",
			requestId: "req-1",
		});
		expect(() => parsePodJobId("bad")).toThrow();
	});
});

describe("PodEngine submit", () => {
	it("creates a pod with bootstrap dockerStartCmd and presigned URLs", async () => {
		const create = mock((spec: { env: Record<string, string> }) => {
			expect(spec.env.OUTPUT_UPLOAD_URL).toContain(
				"generator-artifacts/runpod-pod/req-fixed/output.mp4"
			);
			expect(spec.env.LOG_UPLOAD_URL).toContain(
				"generator-artifacts/runpod-pod/req-fixed/pod.log"
			);
			expect(spec.env.PROMPT).toBe("hello world");
			return Promise.resolve<PodSnapshot>({
				id: "pod-XYZ",
				desiredStatus: "RUNNING",
			});
		});
		const createPutUrl = mock((input: { key: string }) =>
			Promise.resolve(`https://uploads.example.com/${input.key}`)
		);

		const engine = createPodEngine({
			api: buildApi({ create }),
			createPutUrl: createPutUrl as never,
			randomRequestId: () => "req-fixed",
			s3,
			workflow: ltxWorkflow,
		});

		const submission = await engine.submit({ prompt: "hello world" });
		expect(submission.jobId).toBe("pod-XYZ:req-fixed");
		expect(submission.status).toBe("queued");
		expect(create).toHaveBeenCalledTimes(1);
		expect(createPutUrl).toHaveBeenCalledTimes(2);
	});
});

describe("PodEngine getStatus", () => {
	it("returns succeeded and deletes the pod once the artifact is in S3", async () => {
		const deleteFn = mock(() => Promise.resolve());
		const statObject = mock((key: string) =>
			Promise.resolve(makeStat(key, 2048))
		);
		const engine = createPodEngine({
			api: buildApi({ delete: deleteFn }),
			s3,
			statObject: statObject as never,
			workflow: ltxWorkflow,
		});

		const job = await engine.getStatus("pod-XYZ:req-fixed");
		expect(job.status).toBe("succeeded");
		expect(job.progressPct).toBe(100);
		expect(job.output).toEqual({
			logUrl:
				"https://assets.example.com/generator-artifacts/runpod-pod/req-fixed/pod.log",
			podId: "pod-XYZ",
			videoUrl:
				"https://assets.example.com/generator-artifacts/runpod-pod/req-fixed/output.mp4",
		});
		expect(deleteFn).toHaveBeenCalledWith("pod-XYZ");
	});

	it("fails terminated pods that never uploaded artifacts", async () => {
		const deleteFn = mock(() => Promise.resolve());
		const get = mock(() =>
			Promise.resolve<PodSnapshot>({
				id: "pod-XYZ",
				desiredStatus: "EXITED",
			})
		);
		const statObject = mock(() => {
			throw new Error("not found");
		});
		const engine = createPodEngine({
			api: buildApi({ delete: deleteFn, get }),
			s3,
			statObject: statObject as never,
			workflow: ltxWorkflow,
		});

		const job = await engine.getStatus("pod-XYZ:req-fixed");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toContain("finished without uploading output");
		expect(deleteFn).toHaveBeenCalledTimes(1);
	});

	it("reports running while pod desiredStatus is RUNNING", async () => {
		const get = mock(() =>
			Promise.resolve<PodSnapshot>({
				id: "pod-XYZ",
				desiredStatus: "RUNNING",
			})
		);
		const statObject = mock(() => {
			throw new Error("not found");
		});
		const engine = createPodEngine({
			api: buildApi({ get }),
			s3,
			statObject: statObject as never,
			workflow: ltxWorkflow,
		});

		const job = await engine.getStatus("pod-XYZ:req-fixed");
		expect(job.status).toBe("running");
		expect(job.errorSummary).toBeNull();
		expect(job.output).toBeNull();
	});

	it("treats a missing pod as failed without throwing", async () => {
		const get = mock(() => Promise.reject(new Error("404 pod gone")));
		const statObject = mock(() => {
			throw new Error("not found");
		});
		const engine = createPodEngine({
			api: buildApi({ get }),
			s3,
			statObject: statObject as never,
			workflow: ltxWorkflow,
		});

		const job = await engine.getStatus("pod-XYZ:req-fixed");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("404 pod gone");
	});
});

describe("PodEngine cancel", () => {
	it("issues delete on the parsed podId", async () => {
		const deleteFn = mock(() => Promise.resolve());
		const engine = createPodEngine({
			api: buildApi({ delete: deleteFn }),
			s3,
			workflow: ltxWorkflow,
		});
		await engine.cancel("pod-A:req-2");
		expect(deleteFn).toHaveBeenCalledWith("pod-A");
	});
});
