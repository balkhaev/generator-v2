import { describe, expect, it } from "bun:test";
import {
	createWanVideoServerlessWorkflow,
	snapFrameCount,
} from "./wan-2-2-video-serverless";

const PNG_1X1_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const NO_OUTPUT_IMAGES_PATTERN = /no output images/u;
const ONLY_STATIC_PATTERN = /only static image outputs/u;

interface GraphNode {
	class_type: string;
	inputs: Record<string, unknown>;
}
type Graph = Record<string, GraphNode>;

function buildFakeImageResponse(): Response {
	const bytes = Uint8Array.from(atob(PNG_1X1_BASE64), (c) => c.charCodeAt(0));
	const arrayBuffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	);
	return new Response(arrayBuffer, {
		headers: { "content-type": "image/png" },
		status: 200,
	});
}

async function buildGraph(
	config: Parameters<typeof createWanVideoServerlessWorkflow>[0],
	input: Parameters<
		ReturnType<typeof createWanVideoServerlessWorkflow>["buildPayload"]
	>[0],
	requestId: string
): Promise<Graph> {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		buildFakeImageResponse()) as unknown as typeof fetch;
	try {
		const wf = createWanVideoServerlessWorkflow(config);
		const payload = await wf.buildPayload(input, { requestId });
		return payload.workflow as Graph;
	} finally {
		globalThis.fetch = originalFetch;
	}
}

describe("snapFrameCount", () => {
	it("snaps to nearest 4n+1 within bounds", () => {
		expect(snapFrameCount(81)).toBe(81);
		expect(snapFrameCount(80)).toBe(81);
		expect(snapFrameCount(83)).toBe(85);
		expect(snapFrameCount(5)).toBe(17);
		expect(snapFrameCount(999)).toBe(121);
	});
});

describe("createWanVideoServerlessWorkflow", () => {
	it("declares serverless mode + default policy", () => {
		const wf = createWanVideoServerlessWorkflow({ endpointId: "ep-test" });
		expect(wf.mode).toBe("serverless");
		expect(wf.endpointId).toBe("ep-test");
		expect(wf.id).toBe("wan-2-2-video-serverless");
		expect(wf.warmup).toBeUndefined();
		expect(wf.defaultPolicy?.executionTimeout).toBeGreaterThan(60_000);
		expect(wf.defaultPolicy?.ttl).toBeGreaterThan(
			wf.defaultPolicy?.executionTimeout ?? 0
		);
	});

	it("declares warmup payload when enableWarmup is true", () => {
		const wf = createWanVideoServerlessWorkflow({
			enableWarmup: true,
			endpointId: "ep-test",
		});
		expect(wf.warmup).toBeDefined();
		const input = wf.warmup?.buildInput();
		expect(input?.prompt).toBe("warmup");
		expect(input?.numFrames).toBe(17);
	});

	it("builds payload with inline base64 image + patches prompt/seed/dims", async () => {
		const graph = await buildGraph(
			{ endpointId: "ep-test" },
			{
				height: 832,
				inputImageUrl: "https://example.test/cat.png",
				negativePrompt: "blurry",
				numFrames: 81,
				prompt: "cinematic shot of a cat",
				seed: 1234,
				width: 480,
			},
			"req-42"
		);
		expect(graph["20"]?.inputs?.text).toBe("cinematic shot of a cat");
		expect(graph["21"]?.inputs?.text).toBe("blurry");
		expect(graph["14"]?.inputs?.image).toBe("req-req-42.png");
		expect(graph["40"]?.inputs?.width).toBe(480);
		expect(graph["40"]?.inputs?.height).toBe(832);
		expect(graph["40"]?.inputs?.length).toBe(81);
		expect(graph["50"]?.inputs?.noise_seed).toBe(1234);
		expect(graph["51"]?.inputs?.noise_seed).toBe(1234);
	});

	it("splits steps between high/low experts at the noise boundary", async () => {
		const graph = await buildGraph(
			{ endpointId: "ep-test" },
			{
				inputImageUrl: "https://example.test/cat.png",
				prompt: "x",
				steps: 20,
			},
			"req-split"
		);
		expect(graph["50"]?.inputs?.steps).toBe(20);
		expect(graph["50"]?.inputs?.end_at_step).toBe(10);
		expect(graph["51"]?.inputs?.start_at_step).toBe(10);
		expect(graph["51"]?.inputs?.end_at_step).toBe(10_000);
	});

	it("applies custom model filenames from config", async () => {
		const graph = await buildGraph(
			{
				endpointId: "ep-test",
				highNoiseModelFilename: "wan_high_custom.safetensors",
				lowNoiseModelFilename: "wan_low_custom.safetensors",
				textEncoderFilename: "umt5_custom.safetensors",
				vaeFilename: "wan_vae_custom.safetensors",
			},
			{ inputImageUrl: "https://example.test/cat.png", prompt: "x" },
			"req-models"
		);
		expect(graph["10"]?.inputs?.unet_name).toBe("wan_high_custom.safetensors");
		expect(graph["11"]?.inputs?.unet_name).toBe("wan_low_custom.safetensors");
		expect(graph["12"]?.inputs?.clip_name).toBe("umt5_custom.safetensors");
		expect(graph["13"]?.inputs?.vae_name).toBe("wan_vae_custom.safetensors");
	});

	it("inserts scenario LoRA on both expert paths when civitai ids provided", async () => {
		const graph = await buildGraph(
			{ endpointId: "ep-test" },
			{
				inputImageUrl: "https://example.test/cat.png",
				loraCivitaiModelId: 12_345,
				loraCivitaiVersionId: 67_890,
				loraScale: 0.8,
				prompt: "with lora",
			},
			"req-lora"
		);
		expect(graph["9111"]?.class_type).toBe("LoraLoaderModelOnly");
		expect(graph["9111"]?.inputs?.lora_name).toBe(
			"civitai-12345-67890.safetensors"
		);
		expect(graph["9111"]?.inputs?.strength_model).toBe(0.8);
		expect(graph["9112"]?.inputs?.lora_name).toBe(
			"civitai-12345-67890.safetensors"
		);
		// ModelSamplingSD3 теперь читает model из LoRA-лоадера, а не напрямую UNET.
		expect(graph["30"]?.inputs?.model).toEqual(["9111", 0]);
		expect(graph["31"]?.inputs?.model).toEqual(["9112", 0]);
	});

	it("injects separate high/low scenario LoRA filenames", async () => {
		const graph = await buildGraph(
			{ endpointId: "ep-test" },
			{
				inputImageUrl: "https://example.test/cat.png",
				loraHighFilename: "wan22-pussy-high_noise.safetensors",
				loraLowFilename: "wan22-pussy-low_noise.safetensors",
				prompt: "with dual lora",
			},
			"req-dual-lora"
		);
		expect(graph["9111"]?.inputs?.lora_name).toBe(
			"wan22-pussy-high_noise.safetensors"
		);
		expect(graph["9112"]?.inputs?.lora_name).toBe(
			"wan22-pussy-low_noise.safetensors"
		);
	});

	it("does not inject LoRA loaders when no civitai ids provided", async () => {
		const graph = await buildGraph(
			{ endpointId: "ep-test" },
			{ inputImageUrl: "https://example.test/cat.png", prompt: "noop" },
			"req-nolora"
		);
		expect(graph["9111"]).toBeUndefined();
		expect(graph["9112"]).toBeUndefined();
		expect(graph["30"]?.inputs?.model).toEqual(["10", 0]);
		expect(graph["31"]?.inputs?.model).toEqual(["11", 0]);
	});

	it("chains accel + scenario LoRA on each expert in order", async () => {
		const graph = await buildGraph(
			{
				accelLoraHighFilename: "lightx2v_high.safetensors",
				accelLoraLowFilename: "lightx2v_low.safetensors",
				endpointId: "ep-test",
			},
			{
				inputImageUrl: "https://example.test/cat.png",
				loraCivitaiModelId: 1,
				loraCivitaiVersionId: 2,
				prompt: "x",
			},
			"req-accel"
		);
		// UNET → accel → scenario → ModelSamplingSD3 (high path).
		expect(graph["9101"]?.inputs?.lora_name).toBe("lightx2v_high.safetensors");
		expect(graph["9101"]?.inputs?.model).toEqual(["10", 0]);
		expect(graph["9111"]?.inputs?.model).toEqual(["9101", 0]);
		expect(graph["30"]?.inputs?.model).toEqual(["9111", 0]);
	});

	it("injects fallback SaveImage + SaveAnimatedWEBP over VAEDecode", async () => {
		const graph = await buildGraph(
			{ endpointId: "ep-test" },
			{ inputImageUrl: "https://example.test/cat.png", prompt: "x" },
			"req-fallback"
		);
		expect(graph["9001"]?.class_type).toBe("SaveImage");
		expect(graph["9001"]?.inputs?.images).toEqual(["60", 0]);
		expect(graph["9002"]?.class_type).toBe("SaveAnimatedWEBP");
		expect(graph["9002"]?.inputs?.images).toEqual(["60", 0]);
	});

	it("parses serverless output (s3_url mp4)", () => {
		const wf = createWanVideoServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [
				{ data: "https://s3.test/out.mp4", filename: "x.mp4", type: "s3_url" },
			],
		});
		expect(output.videoUrl).toBe("https://s3.test/out.mp4");
	});

	it("throws when worker returns no images", () => {
		const wf = createWanVideoServerlessWorkflow({ endpointId: "ep" });
		expect(() => wf.parseOutput({ images: [] })).toThrow(
			NO_OUTPUT_IMAGES_PATTERN
		);
	});

	it("throws when worker only returned static PNG frames", () => {
		const wf = createWanVideoServerlessWorkflow({ endpointId: "ep" });
		expect(() =>
			wf.parseOutput({
				images: [
					{
						data: "iVBORw0=",
						filename: "wan-22-frames_00001_.png",
						type: "base64",
					},
				],
			})
		).toThrow(ONLY_STATIC_PATTERN);
	});
});
