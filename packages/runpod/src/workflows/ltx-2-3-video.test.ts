import { describe, expect, it, mock } from "bun:test";

import type { ComfyUIClient, ComfyUIObjectInfoEntry } from "../comfyui/client";
import type { PodSubmitContext } from "../workflow/definition";
import {
	createLtx23VideoWorkflow,
	deriveOutputDimensionsFromImage,
	LTX_23_I2V_NODE_IDS,
	probeImageDimensions,
} from "./ltx-2-3-video";

const SAMPLE_INPUT_IMAGE_URL = "https://example.com/in.png";
const SAMPLE_BYTES = new ArrayBuffer(8);
const FAILED_RESOLVE_LORA_PATTERN = /Failed to resolve Civitai LoRA filename/u;

const TEMPLATE_REQUIRED_FILES_BY_NODE: Record<
	string,
	Record<string, string[]>
> = {
	DualCLIPLoader: {
		clip_name1: ["comfyui/gemma-3-12b-it-heretic-v2.safetensors"],
		clip_name2: ["text_encoders/ltx-2.3_text_projection_bf16.safetensors"],
	},
	LatentUpscaleModelLoader: {
		model_name: ["ltx-2.3-spatial-upscaler-x2-1.1.safetensors"],
	},
	LoraLoaderModelOnly: {
		lora_name: [
			"loras/ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
		],
	},
	UNETLoader: {
		unet_name: [
			"diffusion_models/ltx-2.3-22b-dev_transformer_only_bf16.safetensors",
		],
	},
	VAELoader: {
		vae_name: [
			"vae/LTX23_video_vae_bf16.safetensors",
			"vae/taeltx2_3.safetensors",
		],
	},
	VAELoaderKJ: {
		vae_name: ["vae/LTX23_audio_vae_bf16.safetensors"],
	},
};

function buildObjectInfoEntry(
	nodeClass: string
): ComfyUIObjectInfoEntry | null {
	const fields = TEMPLATE_REQUIRED_FILES_BY_NODE[nodeClass];
	if (!fields) {
		return null;
	}
	const required: Record<string, [string[], Record<string, unknown>]> = {};
	for (const [input, list] of Object.entries(fields)) {
		required[input] = [list, {}];
	}
	return { input: { required } };
}

function readyObjectInfo() {
	return mock((nodeClass: string) =>
		Promise.resolve(buildObjectInfoEntry(nodeClass))
	);
}

function buildClient(overrides: Partial<ComfyUIClient> = {}): ComfyUIClient {
	const noop = mock(() => Promise.reject(new Error("not stubbed")));
	return {
		authorizedFetch: noop as never,
		cancelDownload: noop as never,
		downloadArtifact: noop as never,
		getCivitaiVersionInfo: noop as never,
		getHistory: noop as never,
		getHistoryEntry: noop as never,
		getLoraManagerLibraries: noop as never,
		getLoraManagerSettings: noop as never,
		getObjectInfo: readyObjectInfo() as never,
		getQueue: noop as never,
		getSystemStats: noop as never,
		listUserdata: noop as never,
		login: () => Promise.resolve(),
		pollLoraDownload: noop as never,
		readUserdata: noop as never,
		startLoraDownload: noop as never,
		submitPrompt: noop as never,
		updateLoraManagerSettings: noop as never,
		uploadInputImage: noop as never,
		...overrides,
	};
}

// Generates the smallest valid JPEG header that exposes width × height to a
// SOF parser. Не настоящий JPEG (нет самих данных), но нашему `probeImageDimensions`
// достаточно SOI + один SOF0 сегмент.
function buildJpeg(width: number, height: number): ArrayBuffer {
	const buf = new Uint8Array(20);
	const view = new DataView(buf.buffer);
	view.setUint16(0, 0xff_d8); // SOI
	view.setUint8(2, 0xff);
	view.setUint8(3, 0xc0); // SOF0
	view.setUint16(4, 11); // segment length
	view.setUint8(6, 8); // precision
	view.setUint16(7, height);
	view.setUint16(9, width);
	return buf.buffer;
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
	it("leaves width/height undefined so they can be derived from the input image", () => {
		const wf = buildWorkflow();
		const parsed = wf.inputSchema.parse({
			inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
			prompt: "hi",
		});
		expect(parsed).toMatchObject({
			cfgScale: 1,
			fps: 24,
			numFrames: 121,
			prompt: "hi",
			steps: 8,
		});
		expect(parsed.width).toBeUndefined();
		expect(parsed.height).toBeUndefined();
	});

	it("buildPrompt patches user prompt, dims, seed and image filename in the API graph", async () => {
		const wf = buildWorkflow();
		const ctx: PodSubmitContext = {
			client: buildClient(),
			clientId: "req-1",
			requestId: "req-1",
		};
		const result = await wf.buildPrompt(
			{
				height: 736,
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
			736
		);
		expect(
			result.prompt[LTX_23_I2V_NODE_IDS.NODE_LOAD_IMAGE]?.inputs.image
		).toBe("req-req-1.png");
	});

	it("buildPrompt derives output dimensions from the input image when not explicit", async () => {
		const wf = buildWorkflow({
			fetchBytes: () => Promise.resolve(buildJpeg(700, 875)),
		});
		const result = await wf.buildPrompt(
			{
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				prompt: "p",
			},
			{
				client: buildClient(),
				clientId: "r-1",
				requestId: "r-1",
			}
		);
		// LTX 2.3 graph внутри ресайзит картинку до longer-edge 1536, из-за
		// чего запрос вроде 704×864 раздувается неравномерно. Нормализуем
		// исходный aspect ratio (700:875) до 1280 по длинной стороне
		// (→ 1024×1280 — оба %32).
		expect(result.prompt[LTX_23_I2V_NODE_IDS.NODE_WIDTH]?.inputs.value).toBe(
			1024
		);
		expect(result.prompt[LTX_23_I2V_NODE_IDS.NODE_HEIGHT]?.inputs.value).toBe(
			1280
		);
	});

	it("buildPrompt snaps explicit non-multiple-of-32 dims to nearest valid LTX size", async () => {
		const wf = buildWorkflow();
		const result = await wf.buildPrompt(
			{
				height: 720,
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				prompt: "p",
				width: 1281,
			},
			{
				client: buildClient(),
				clientId: "r-2",
				requestId: "r-2",
			}
		);
		expect(result.prompt[LTX_23_I2V_NODE_IDS.NODE_WIDTH]?.inputs.value).toBe(
			1280
		);
		expect(result.prompt[LTX_23_I2V_NODE_IDS.NODE_HEIGHT]?.inputs.value).toBe(
			736
		);
	});

	it("buildPrompt swaps the LoraManager slot for a standard LoraLoaderModelOnly when ids are provided", async () => {
		const wf = buildWorkflow();
		const getCivitaiVersionInfo = mock(() =>
			Promise.resolve({
				files: [
					{
						name: "synth-pussy-LTX-2-3.safetensors",
						primary: true,
					},
				],
				id: 2_841_299,
				modelId: 2_509_189,
			})
		);
		const result = await wf.buildPrompt(
			{
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				loraCivitaiModelId: 2_509_189,
				loraCivitaiVersionId: 2_841_299,
				loraScale: 0.85,
				prompt: "p",
			},
			{
				client: buildClient({
					getCivitaiVersionInfo: getCivitaiVersionInfo as never,
				}),
				clientId: "r-1",
				requestId: "r-1",
			}
		);
		const loraNode = result.prompt[LTX_23_I2V_NODE_IDS.NODE_LORA_LOADER];
		expect(loraNode).toBeDefined();
		expect(loraNode?.class_type).toBe("LoraLoaderModelOnly");
		const inputs = loraNode?.inputs as {
			lora_name: string;
			model: [string, number];
			strength_model: number;
		};
		expect(inputs.lora_name).toBe("synth-pussy-LTX-2-3.safetensors");
		expect(inputs.strength_model).toBe(0.85);
		expect(Array.isArray(inputs.model)).toBe(true);
		expect(getCivitaiVersionInfo).toHaveBeenCalledWith("loras", 2_841_299);
	});

	it("buildPrompt resolves Civitai filename to LoraManager subfolder path via /object_info combo", async () => {
		const wf = buildWorkflow();
		const getCivitaiVersionInfo = mock(() =>
			Promise.resolve({
				files: [{ name: "SynthPussy_01_rank32.safetensors", primary: true }],
				id: 2_820_451,
				modelId: 2_509_189,
			})
		);
		const getObjectInfo = mock((nodeClass: string) => {
			if (nodeClass === "LoraLoaderModelOnly") {
				return Promise.resolve({
					input: {
						required: {
							lora_name: [
								[
									"loras/ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
									"LTXV 2.3/concept/SynthPussy_01_rank32.safetensors",
								],
								{},
							],
						},
					},
				});
			}
			return Promise.resolve(null);
		});
		const result = await wf.buildPrompt(
			{
				inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
				loraCivitaiModelId: 2_509_189,
				loraCivitaiVersionId: 2_820_451,
				loraScale: 1,
				prompt: "p",
			},
			{
				client: buildClient({
					getCivitaiVersionInfo: getCivitaiVersionInfo as never,
					getObjectInfo: getObjectInfo as never,
				}),
				clientId: "r-1",
				requestId: "r-1",
			}
		);
		const loraNode = result.prompt[LTX_23_I2V_NODE_IDS.NODE_LORA_LOADER];
		expect(loraNode?.class_type).toBe("LoraLoaderModelOnly");
		const inputs = loraNode?.inputs as { lora_name: string };
		expect(inputs.lora_name).toBe(
			"LTXV 2.3/concept/SynthPussy_01_rank32.safetensors"
		);
	});

	it("buildPrompt throws when Civitai LoRA filename cannot be resolved", async () => {
		const wf = buildWorkflow();
		const getCivitaiVersionInfo = mock(() => Promise.resolve(null));
		await expect(
			wf.buildPrompt(
				{
					inputImageUrl: SAMPLE_INPUT_IMAGE_URL,
					loraCivitaiModelId: 1,
					loraCivitaiVersionId: 2,
					prompt: "p",
				},
				{
					client: buildClient({
						getCivitaiVersionInfo: getCivitaiVersionInfo as never,
					}),
					clientId: "r-1",
					requestId: "r-1",
				}
			)
		).rejects.toThrow(FAILED_RESOLVE_LORA_PATTERN);
	});

	it("prepare returns ready=false while LTX 2.3 models are still being provisioned", async () => {
		const wf = buildWorkflow();
		const status = await wf.prepare?.({
			client: buildClient({
				getObjectInfo: (() =>
					Promise.resolve({
						input: { required: { unet_name: [[], {}] } },
					})) as never,
			}),
			downloadId: "r-1",
			input: { inputImageUrl: SAMPLE_INPUT_IMAGE_URL, prompt: "p" },
			requestId: "r-1",
		});
		expect(status?.ready).toBe(false);
		expect(typeof status?.progressPct).toBe("number");
	});

	it("prepare reads modern ComfyUI COMBO entries (e.g. LatentUpscaleModelLoader)", async () => {
		const wf = buildWorkflow();
		const getObjectInfo = mock((nodeClass: string) => {
			if (nodeClass === "LatentUpscaleModelLoader") {
				return Promise.resolve({
					input: {
						required: {
							model_name: [
								"COMBO",
								{
									multiselect: false,
									options: ["ltx-2.3-spatial-upscaler-x2-1.1.safetensors"],
								},
							],
						},
					},
				});
			}
			return Promise.resolve(buildObjectInfoEntry(nodeClass));
		});
		const status = await wf.prepare?.({
			client: buildClient({
				getObjectInfo: getObjectInfo as never,
				uploadInputImage: (() =>
					Promise.resolve({
						name: "x",
						subfolder: "",
						type: "input",
					})) as never,
			}),
			downloadId: "r-1",
			input: { inputImageUrl: SAMPLE_INPUT_IMAGE_URL, prompt: "p" },
			requestId: "r-1",
		});
		expect(status).toEqual({ ready: true });
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
		const updateLoraManagerSettings = mock(() => Promise.resolve());
		const wf = buildWorkflow();
		const status = await wf.prepare?.({
			client: buildClient({
				getLoraManagerLibraries: (() =>
					Promise.resolve({
						active_library: "comfyui",
						libraries: {
							comfyui: {
								folder_paths: {
									loras: ["/workspace/ComfyUI/models/loras"],
								},
							},
						},
					})) as never,
				getLoraManagerSettings: (() => Promise.resolve({})) as never,
				pollLoraDownload: pollLoraDownload as never,
				startLoraDownload: startLoraDownload as never,
				updateLoraManagerSettings: updateLoraManagerSettings as never,
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
		expect(updateLoraManagerSettings).toHaveBeenCalledWith({
			default_lora_root: "/workspace/ComfyUI/models/loras",
		});
	});

	it("prepare skips updateLoraManagerSettings when default_lora_root already set", async () => {
		const startLoraDownload = mock(() => Promise.resolve({}));
		const pollLoraDownload = mock(() => Promise.resolve({ status: "idle" }));
		const updateLoraManagerSettings = mock(() => Promise.resolve());
		const wf = buildWorkflow();
		const status = await wf.prepare?.({
			client: buildClient({
				getLoraManagerSettings: (() =>
					Promise.resolve({
						default_lora_root: "/workspace/ComfyUI/models/loras",
					})) as never,
				pollLoraDownload: pollLoraDownload as never,
				startLoraDownload: startLoraDownload as never,
				updateLoraManagerSettings: updateLoraManagerSettings as never,
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
		expect(updateLoraManagerSettings).not.toHaveBeenCalled();
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

describe("ltx 2.3 dimension helpers", () => {
	it("probes JPEG SOF dimensions", () => {
		expect(probeImageDimensions(buildJpeg(700, 875))).toEqual({
			height: 875,
			width: 700,
		});
	});

	it("probes PNG IHDR dimensions", () => {
		const buf = new Uint8Array(24);
		const view = new DataView(buf.buffer);
		view.setUint32(0, 0x89_50_4e_47);
		view.setUint32(4, 0x0d_0a_1a_0a);
		view.setUint32(16, 1920);
		view.setUint32(20, 1080);
		expect(probeImageDimensions(buf.buffer)).toEqual({
			height: 1080,
			width: 1920,
		});
	});

	it("returns null on unsupported / truncated buffers", () => {
		expect(probeImageDimensions(new ArrayBuffer(8))).toBeNull();
		expect(probeImageDimensions(new ArrayBuffer(0))).toBeNull();
	});

	it("scales a small portrait source up to MAX_OUTPUT_EDGE_PX preserving aspect", () => {
		expect(
			deriveOutputDimensionsFromImage({ height: 875, width: 700 })
		).toEqual({
			height: 1280,
			width: 1024,
		});
	});

	it("scales an oversized landscape source down to MAX_OUTPUT_EDGE_PX preserving aspect", () => {
		expect(
			deriveOutputDimensionsFromImage({ height: 1080, width: 1920 })
		).toEqual({ height: 736, width: 1280 });
	});

	it("normalises a square source to MAX_OUTPUT_EDGE_PX × MAX_OUTPUT_EDGE_PX", () => {
		expect(deriveOutputDimensionsFromImage({ height: 64, width: 64 })).toEqual({
			height: 1280,
			width: 1280,
		});
	});
});
