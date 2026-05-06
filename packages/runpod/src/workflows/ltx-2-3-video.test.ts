import { describe, expect, it, mock } from "bun:test";

import type { ComfyUIClient } from "../comfyui/client";
import type { PodSubmitContext } from "../workflow/definition";
import { createLtx23VideoWorkflow, LTX_23_I2V_NODE_IDS } from "./ltx-2-3-video";

const SAMPLE_INPUT_IMAGE_URL = "https://example.com/in.png";
const SAMPLE_BYTES = new ArrayBuffer(8);

function buildClient(overrides: Partial<ComfyUIClient> = {}): ComfyUIClient {
	const noop = mock(() => Promise.reject(new Error("not stubbed")));
	return {
		authorizedFetch: noop as never,
		cancelDownload: noop as never,
		downloadArtifact: noop as never,
		getHistory: noop as never,
		getHistoryEntry: noop as never,
		getQueue: noop as never,
		getSystemStats: noop as never,
		listUserdata: noop as never,
		login: () => Promise.resolve(),
		pollLoraDownload: noop as never,
		readUserdata: noop as never,
		startLoraDownload: noop as never,
		submitPrompt: noop as never,
		uploadInputImage: noop as never,
		...overrides,
	};
}

function buildWorkflow(deps: { fetchBytes?: () => Promise<ArrayBuffer> } = {}) {
	return createLtx23VideoWorkflow(
		{
			pod: {
				gpuTypeIds: ["NVIDIA RTX A6000"],
				imageName: "ls250824/run-comfyui-ltx:test",
				templateId: "p4f6rm9tb4",
			},
		},
		{
			fetchBytes: deps.fetchBytes ?? (() => Promise.resolve(SAMPLE_BYTES)),
		}
	);
}

describe("ltx-2-3-video workflow", () => {
	it("normalises input with sane defaults", () => {
		const wf = buildWorkflow();
		const parsed = wf.inputSchema.parse({
			inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
			prompt: "hi",
		});
		expect(parsed).toMatchObject({
			cfgScale: 1,
			fps: 24,
			height: 736,
			numFrames: 121,
			prompt: "hi",
			steps: 8,
			width: 1280,
		});
	});

	it("buildPrompt patches user prompt, dims, seed and image filename in the API graph", () => {
		const wf = buildWorkflow();
		const ctx: PodSubmitContext = {
			clientId: "req-1",
			requestId: "req-1",
		};
		const result = wf.buildPrompt(
			{
				height: 720,
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				numFrames: 121,
				prompt: "a cat dancing",
				seed: 7,
				width: 1280,
			},
			ctx
		);
		expect(result.prompt[LTX_23_I2V_NODE_IDS.NODE_PROMPT]?.inputs.value).toBe(
			"a cat dancing"
		);
		expect(
			result.prompt[LTX_23_I2V_NODE_IDS.NODE_NOISE_FIRST]?.inputs.noise_seed
		).toBe(7);
		expect(
			result.prompt[LTX_23_I2V_NODE_IDS.NODE_NOISE_SECOND]?.inputs.noise_seed
		).toBe(8);
		expect(result.prompt[LTX_23_I2V_NODE_IDS.NODE_WIDTH]?.inputs.value).toBe(
			1280
		);
		expect(result.prompt[LTX_23_I2V_NODE_IDS.NODE_HEIGHT]?.inputs.value).toBe(
			720
		);
		expect(
			result.prompt[LTX_23_I2V_NODE_IDS.NODE_LOAD_IMAGE]?.inputs.image
		).toBe("req-req-1.png");
	});

	it("buildPrompt installs Civitai LoRA in the LoraManager node when ids are provided", () => {
		const wf = buildWorkflow();
		const result = wf.buildPrompt(
			{
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				loraCivitaiModelId: 2_509_189,
				loraCivitaiVersionId: 2_841_299,
				loraScale: 0.85,
				prompt: "p",
			},
			{ clientId: "r-1", requestId: "r-1" }
		);
		const loraNode = result.prompt[LTX_23_I2V_NODE_IDS.NODE_LORA_LOADER];
		expect(loraNode).toBeDefined();
		const inputs = loraNode?.inputs as {
			loras: { __value__: Array<{ name: string; strength: number }> };
		};
		expect(inputs.loras.__value__).toEqual([
			{
				active: true,
				name: "civitai-2509189-2841299.safetensors",
				strength: 0.85,
			},
		] as never);
	});

	it("prepare uploads input image bytes and reports ready=true without LoRA", async () => {
		const uploadInputImage = mock(() =>
			Promise.resolve({ name: "x", subfolder: "", type: "input" })
		);
		const wf = buildWorkflow();
		const status = await wf.prepare?.({
			client: buildClient({ uploadInputImage: uploadInputImage as never }),
			downloadId: "r-1",
			input: { inputImageUrl: SAMPLE_INPUT_IMAGE_URL, prompt: "p" },
			requestId: "r-1",
		});
		expect(status).toEqual({ ready: true });
		expect(uploadInputImage).toHaveBeenCalledTimes(1);
	});

	it("prepare starts a Civitai LoRA download when one is requested but missing", async () => {
		const startLoraDownload = mock(() => Promise.resolve({}));
		const pollLoraDownload = mock(() => Promise.resolve({ status: "idle" }));
		const wf = buildWorkflow();
		const status = await wf.prepare?.({
			client: buildClient({
				pollLoraDownload: pollLoraDownload as never,
				startLoraDownload: startLoraDownload as never,
				uploadInputImage: (() =>
					Promise.resolve({
						name: "x",
						subfolder: "",
						type: "input",
					})) as never,
			}),
			downloadId: "req-1",
			input: {
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				loraCivitaiModelId: 2_509_189,
				loraCivitaiVersionId: 2_841_299,
				prompt: "x",
			},
			requestId: "req-1",
		});
		expect(status?.ready).toBe(false);
		expect(startLoraDownload).toHaveBeenCalledTimes(1);
	});

	it("prepare reports ready=true once LoRA download completes", async () => {
		const wf = buildWorkflow();
		const status = await wf.prepare?.({
			client: buildClient({
				pollLoraDownload: (() =>
					Promise.resolve({
						progress: 100,
						status: "completed",
					})) as never,
				uploadInputImage: (() =>
					Promise.resolve({
						name: "x",
						subfolder: "",
						type: "input",
					})) as never,
			}),
			downloadId: "req-1",
			input: {
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				loraCivitaiModelId: 2_509_189,
				loraCivitaiVersionId: 2_841_299,
				prompt: "x",
			},
			requestId: "req-1",
		});
		expect(status).toMatchObject({ progressPct: 100, ready: true });
	});

	it("parseOutput returns artifact public URL and pod metadata", () => {
		const wf = buildWorkflow();
		const output = wf.parseOutput({
			artifactPublicUrl: "https://assets.example.com/output.mp4",
			artifactStat: {
				etag: "etag",
				key: "output.mp4",
				lastModified: new Date(),
				sizeBytes: 1234,
				type: "video/mp4",
				url: "https://assets.example.com/output.mp4",
			},
			podId: "pod-7",
			requestId: "req-1",
			runpodPodConsoleUrl: "https://runpod.io/console/pods/pod-7",
		});
		expect(output).toEqual({
			podConsoleUrl: "https://runpod.io/console/pods/pod-7",
			podId: "pod-7",
			requestId: "req-1",
			videoUrl: "https://assets.example.com/output.mp4",
		});
	});
});
