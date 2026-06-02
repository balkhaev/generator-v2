import { describe, expect, it, mock } from "bun:test";
import type { S3ObjectStat, S3StorageConfig } from "@generator/storage";
import { z } from "zod";

import type { ComfyUIClient } from "../comfyui/client";
import type {
	ComfyUIHistoryItem,
	ComfyUIQueueResponse,
} from "../comfyui/types";
import type { PodWorkflow } from "../workflow/definition";
import {
	createStaticPodEngine,
	formatStaticJobId,
	parseStaticJobId,
} from "./static-pod-engine";

const s3: S3StorageConfig = {
	accessKeyId: "access",
	bucket: "assets",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "hel1",
	secretAccessKey: "secret",
};

const COMFY_BASE_URL = "https://pod-1-8188.proxy.runpod.net";

const inputSchema = z.object({ prompt: z.string() });

interface VideoOutput {
	requestId: string;
	videoUrl: string;
}

function buildWorkflow(
	overrides: Partial<PodWorkflow<{ prompt: string }, VideoOutput>> = {}
): PodWorkflow<{ prompt: string }, VideoOutput> {
	return {
		artifactContentType: "video/mp4",
		buildPrompt:
			overrides.buildPrompt ??
			(() => ({ prompt: { "1": { class_type: "Foo", inputs: {} } } })),
		id: "ltx-2-3-video",
		inputSchema,
		mode: "pod",
		parseOutput:
			overrides.parseOutput ??
			((ctx) => ({
				requestId: ctx.requestId,
				videoUrl: ctx.artifactPublicUrl,
			})),
		pod: { comfyBaseUrl: COMFY_BASE_URL, imageName: "", networkVolumes: [] },
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

interface ClientStubOverrides {
	authorizedFetch?: ComfyUIClient["authorizedFetch"];
	downloadArtifact?: ComfyUIClient["downloadArtifact"];
	getHistory?: () => Promise<Record<string, ComfyUIHistoryItem>>;
	getQueue?: () => Promise<ComfyUIQueueResponse>;
	submitPrompt?: ComfyUIClient["submitPrompt"];
	uploadInputImage?: ComfyUIClient["uploadInputImage"];
}

function buildClientStub(overrides: ClientStubOverrides = {}): ComfyUIClient {
	const dummy = mock(() => Promise.reject(new Error("not stubbed")));
	return {
		authorizedFetch:
			overrides.authorizedFetch ??
			(mock(() =>
				Promise.resolve(new Response(null, { status: 200 }))
			) as never),
		cancelDownload: dummy as never,
		downloadArtifact:
			overrides.downloadArtifact ??
			(mock(() => Promise.resolve(new ArrayBuffer(8))) as never),
		getCivitaiVersionInfo: dummy as never,
		getHistory: overrides.getHistory ?? (() => Promise.resolve({})),
		getHistoryEntry: dummy as never,
		getLoraManagerLibraries: dummy as never,
		getLoraManagerSettings: dummy as never,
		getObjectInfo: dummy as never,
		getQueue:
			overrides.getQueue ??
			(() => Promise.resolve({ queue_pending: [], queue_running: [] })),
		getSystemStats: dummy as never,
		listUserdata: dummy as never,
		login: () => Promise.resolve(),
		pollLoraDownload: dummy as never,
		readUserdata: dummy as never,
		startLoraDownload: dummy as never,
		submitPrompt:
			overrides.submitPrompt ??
			(mock(() => Promise.resolve({ number: 1, prompt_id: "p-1" })) as never),
		updateLoraManagerSettings: dummy as never,
		uploadInputImage:
			overrides.uploadInputImage ??
			(mock(() =>
				Promise.resolve({ name: "req.png", subfolder: "", type: "input" })
			) as never),
	};
}

function historyWithArtifact(clientId: string): ComfyUIHistoryItem {
	return {
		outputs: {
			"60": {
				videos: [{ filename: "out.mp4", subfolder: "", type: "output" }],
			},
		},
		prompt: [0, "p-1", {}, { client_id: clientId }, []],
		status: { completed: true, messages: [], status_str: "success" },
	};
}

describe("staticPodJobId helpers", () => {
	it("formats and parses static job ids", () => {
		const jobId = formatStaticJobId("req-1");
		expect(jobId).toBe("static:req-1");
		expect(parseStaticJobId(jobId)).toBe("req-1");
		expect(() => parseStaticJobId("pod-1:req:pwd")).toThrow();
		expect(() => parseStaticJobId("static:")).toThrow();
	});
});

describe("createStaticPodEngine submit", () => {
	it("builds prompt and submits to the fixed pod, never creating a pod", async () => {
		const submitPrompt = mock(
			(_arg: { clientId: string; extraData: { client_id: string } }) =>
				Promise.resolve({ number: 1, prompt_id: "p-1" })
		);
		const buildPrompt = mock(() => ({
			prompt: { "1": { class_type: "Foo", inputs: {} } },
		}));
		const client = buildClientStub({ submitPrompt: submitPrompt as never });
		const engine = createStaticPodEngine({
			comfyBaseUrl: COMFY_BASE_URL,
			createClient: () => client,
			randomRequestId: () => "req-1",
			s3,
			workflow: buildWorkflow({ buildPrompt: buildPrompt as never }),
		});

		const submission = await engine.submit({ prompt: "hello" });

		expect(submission.jobId).toBe("static:req-1");
		expect(submission.status).toBe("queued");
		expect(buildPrompt).toHaveBeenCalledTimes(1);
		expect(submitPrompt).toHaveBeenCalledTimes(1);
		const call = submitPrompt.mock.calls[0]?.[0];
		expect(call?.clientId).toBe("req-1");
		expect(call?.extraData.client_id).toBe("req-1");
	});
});

describe("createStaticPodEngine getStatus", () => {
	it("returns running while the prompt is still queued", async () => {
		const client = buildClientStub({
			getHistory: () => Promise.resolve({}),
			getQueue: () =>
				Promise.resolve({
					queue_pending: [[0, "p-1", {}, { client_id: "req-1" }, []]],
					queue_running: [],
				}),
		});
		const engine = createStaticPodEngine({
			comfyBaseUrl: COMFY_BASE_URL,
			createClient: () => client,
			s3,
			statObject: () => Promise.reject(new Error("missing")),
			workflow: buildWorkflow(),
		});

		const job = await engine.getStatus("static:req-1");
		expect(job.status).toBe("running");
	});

	it("downloads the artifact and reports succeeded when history is complete", async () => {
		const uploadObject = mock(() => Promise.resolve());
		let statCalls = 0;
		const statObject = mock((key: string) => {
			statCalls += 1;
			// First call (idempotency probe) misses, post-upload call hits.
			if (statCalls === 1) {
				return Promise.reject(new Error("missing"));
			}
			return Promise.resolve(makeStat(key, 1024));
		});
		const client = buildClientStub({
			getHistory: () =>
				Promise.resolve({ "p-1": historyWithArtifact("req-1") }),
		});
		const engine = createStaticPodEngine({
			comfyBaseUrl: COMFY_BASE_URL,
			createClient: () => client,
			s3,
			statObject: statObject as never,
			uploadObject: uploadObject as never,
			workflow: buildWorkflow(),
		});

		const job = await engine.getStatus("static:req-1");
		expect(job.status).toBe("succeeded");
		expect(uploadObject).toHaveBeenCalledTimes(1);
		expect(job.output?.videoUrl).toContain(
			"generator-artifacts/runpod-static-pod/req-1/output.mp4"
		);
	});

	it("reports succeeded straight from S3 when artifact already exists", async () => {
		const statObject = mock((key: string) =>
			Promise.resolve(makeStat(key, 2048))
		);
		const getHistory = mock(() => Promise.resolve({}));
		const engine = createStaticPodEngine({
			comfyBaseUrl: COMFY_BASE_URL,
			createClient: () => buildClientStub({ getHistory }),
			s3,
			statObject: statObject as never,
			workflow: buildWorkflow(),
		});

		const job = await engine.getStatus("static:req-1");
		expect(job.status).toBe("succeeded");
		expect(getHistory).not.toHaveBeenCalled();
	});

	it("reports failed when ComfyUI workflow errored", async () => {
		const client = buildClientStub({
			getHistory: () =>
				Promise.resolve({
					"p-1": {
						outputs: {},
						prompt: [0, "p-1", {}, { client_id: "req-1" }, []],
						status: {
							completed: true,
							messages: [["execution_error", { exception_message: "boom" }]],
							status_str: "error",
						},
					},
				}),
		});
		const engine = createStaticPodEngine({
			comfyBaseUrl: COMFY_BASE_URL,
			createClient: () => client,
			s3,
			statObject: () => Promise.reject(new Error("missing")),
			workflow: buildWorkflow(),
		});

		const job = await engine.getStatus("static:req-1");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toContain("error");
	});
});

describe("createStaticPodEngine cancel", () => {
	it("interrupts the pod without deleting it", async () => {
		const authorizedFetch = mock((_path: string, _init?: { method: string }) =>
			Promise.resolve(new Response(null, { status: 200 }))
		);
		const client = buildClientStub({
			authorizedFetch: authorizedFetch as never,
		});
		const engine = createStaticPodEngine({
			comfyBaseUrl: COMFY_BASE_URL,
			createClient: () => client,
			s3,
			workflow: buildWorkflow(),
		});

		await engine.cancel("static:req-1");
		expect(authorizedFetch).toHaveBeenCalledTimes(1);
		const call = authorizedFetch.mock.calls[0];
		expect(call?.[0]).toBe("/interrupt");
		expect(call?.[1]?.method).toBe("POST");
	});
});
