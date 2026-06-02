import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

import type { ComfyUIClient } from "../comfyui/client";
import type {
	PodSubmitContext,
	ServerlessWorkflow,
} from "../workflow/definition";
import {
	createComfyPodWorkflow,
	createFluxImagePodWorkflow,
	createLtxVideoPodWorkflow,
	createWanVideoPodWorkflow,
} from "./comfy-pod";

const COMFY_BASE_URL = "https://pod-1-8188.proxy.runpod.net";
const NO_WORKFLOW_GRAPH_PATTERN = /no "workflow" graph/u;

function fakeClient(
	uploadInputImage: ComfyUIClient["uploadInputImage"]
): ComfyUIClient {
	const dummy = mock(() => Promise.reject(new Error("not stubbed")));
	return {
		authorizedFetch: dummy as never,
		cancelDownload: dummy as never,
		downloadArtifact: dummy as never,
		getCivitaiVersionInfo: dummy as never,
		getHistory: dummy as never,
		getHistoryEntry: dummy as never,
		getLoraManagerLibraries: dummy as never,
		getLoraManagerSettings: dummy as never,
		getObjectInfo: dummy as never,
		getQueue: dummy as never,
		getSystemStats: dummy as never,
		listUserdata: dummy as never,
		login: () => Promise.resolve(),
		pollLoraDownload: dummy as never,
		readUserdata: dummy as never,
		startLoraDownload: dummy as never,
		submitPrompt: dummy as never,
		updateLoraManagerSettings: dummy as never,
		uploadInputImage,
	};
}

const successCtx = {
	artifactPublicUrl: "https://assets.example.com/out.mp4",
	artifactStat: {
		etag: "e",
		key: "out.mp4",
		lastModified: new Date(),
		sizeBytes: 1,
		type: "video/mp4",
		url: "https://assets.example.com/out.mp4",
	},
	podId: "pod-1",
	requestId: "req-1",
	runpodPodConsoleUrl: "https://runpod.io/console/pods/pod-1",
};

describe("createComfyPodWorkflow", () => {
	it("uploads images from serverless payload and forwards the graph", async () => {
		const graph = { "1": { class_type: "Foo", inputs: {} } };
		const imageB64 = Buffer.from("png-bytes").toString("base64");
		const serverless = {
			buildPayload: () => ({
				images: [
					{ image: `data:image/png;base64,${imageB64}`, name: "req.png" },
				],
				workflow: graph,
			}),
			inputSchema: z.object({ prompt: z.string() }),
			mode: "serverless" as const,
		} as unknown as ServerlessWorkflow<{ prompt: string }, { url: string }>;

		const uploadInputImage = mock((_arg: { filename: string }) =>
			Promise.resolve({ name: "req.png", subfolder: "", type: "input" })
		);
		const client = fakeClient(uploadInputImage as never);
		const workflow = createComfyPodWorkflow<
			{ prompt: string },
			{ url: string }
		>({
			artifactContentType: "video/mp4",
			comfyBaseUrl: COMFY_BASE_URL,
			id: "test-pod",
			parseArtifact: (ctx) => ({ url: ctx.artifactPublicUrl }),
			serverless,
		});

		const ctx: PodSubmitContext = {
			client,
			clientId: "req-1",
			requestId: "req-1",
		};
		const result = await workflow.buildPrompt({ prompt: "hi" }, ctx);

		expect(result.prompt).toEqual(graph);
		expect(uploadInputImage).toHaveBeenCalledTimes(1);
		const uploadArg = uploadInputImage.mock.calls[0]?.[0];
		expect(uploadArg?.filename).toBe("req.png");
		expect(workflow.mode).toBe("pod");
		expect(workflow.pod.comfyBaseUrl).toBe(COMFY_BASE_URL);
	});

	it("throws when serverless payload has no workflow graph", async () => {
		const serverless = {
			buildPayload: () => ({}),
			inputSchema: z.object({ prompt: z.string() }),
			mode: "serverless" as const,
		} as unknown as ServerlessWorkflow<{ prompt: string }, { url: string }>;
		const workflow = createComfyPodWorkflow<
			{ prompt: string },
			{ url: string }
		>({
			artifactContentType: "video/mp4",
			comfyBaseUrl: COMFY_BASE_URL,
			id: "test-pod",
			parseArtifact: (ctx) => ({ url: ctx.artifactPublicUrl }),
			serverless,
		});
		const client = fakeClient(mock(() => Promise.resolve()) as never);
		await expect(
			workflow.buildPrompt(
				{ prompt: "hi" },
				{ client, clientId: "x", requestId: "x" }
			)
		).rejects.toThrow(NO_WORKFLOW_GRAPH_PATTERN);
	});
});

describe("static pod workflow factories", () => {
	it("LTX factory yields id ltx-2-3-video and video/mp4 output", () => {
		const wf = createLtxVideoPodWorkflow({ comfyBaseUrl: COMFY_BASE_URL });
		expect(wf.id).toBe("ltx-2-3-video");
		expect(wf.mode).toBe("pod");
		expect(wf.artifactContentType).toBe("video/mp4");
		expect(wf.pod.comfyBaseUrl).toBe(COMFY_BASE_URL);
		const out = wf.parseOutput(successCtx);
		expect(out.videoUrl).toBe(successCtx.artifactPublicUrl);
	});

	it("WAN factory yields id wan-2-2-video", () => {
		const wf = createWanVideoPodWorkflow({ comfyBaseUrl: COMFY_BASE_URL });
		expect(wf.id).toBe("wan-2-2-video");
		const out = wf.parseOutput(successCtx);
		expect(out.videoUrl).toBe(successCtx.artifactPublicUrl);
	});

	it("Flux factory yields id flux-dev-image and image/png output", () => {
		const wf = createFluxImagePodWorkflow({ comfyBaseUrl: COMFY_BASE_URL });
		expect(wf.id).toBe("flux-dev-image");
		expect(wf.artifactContentType).toBe("image/png");
		const out = wf.parseOutput(successCtx);
		expect(out.imageUrl).toBe(successCtx.artifactPublicUrl);
		expect(out.imageUrls).toEqual([successCtx.artifactPublicUrl]);
	});
});
