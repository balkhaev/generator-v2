import { describe, expect, it } from "bun:test";
import { createLtx23VideoServerlessWorkflow } from "./ltx-2-3-video-serverless";

const PNG_1X1_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const VALIDATION_ERROR_PATTERN = /validation failed/u;
const NO_OUTPUT_IMAGES_PATTERN = /no output images/u;
const ONLY_IMAGE_OUTPUTS_PATTERN = /only image outputs/u;

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

describe("createLtx23VideoServerlessWorkflow", () => {
	it("declares serverless mode + carries our default policy", () => {
		const wf = createLtx23VideoServerlessWorkflow({
			endpointId: "ep-test",
		});
		expect(wf.mode).toBe("serverless");
		expect(wf.endpointId).toBe("ep-test");
		expect(wf.id).toBe("ltx-2-3-video-serverless");
		expect(wf.defaultPolicy?.executionTimeout).toBeGreaterThan(60_000);
		expect(wf.defaultPolicy?.ttl).toBeGreaterThan(
			wf.defaultPolicy?.executionTimeout ?? 0
		);
	});

	it("builds RunPod payload: ComfyUI graph + inline base64 input image", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			buildFakeImageResponse()) as unknown as typeof fetch;
		try {
			const wf = createLtx23VideoServerlessWorkflow({
				endpointId: "ep-test",
			});
			const payload = await wf.buildPayload(
				{
					inputImageUrl: "https://example.test/cat.png",
					negativePrompt: "blurry",
					numFrames: 24,
					prompt: "cinematic shot of a cat",
					seed: 1234,
				},
				{ requestId: "req-42" }
			);
			expect(payload.workflow).toBeDefined();
			expect(payload.images).toEqual([
				{
					image: `data:image/png;base64,${PNG_1X1_BASE64}`,
					name: "req-req-42.png",
				},
			]);
			const graph = payload.workflow as Record<
				string,
				{ inputs: Record<string, unknown> }
			>;
			expect(graph["352"]?.inputs?.value).toBe("cinematic shot of a cat");
			expect(graph["110"]?.inputs?.text).toBe("blurry");
			expect(graph["115"]?.inputs?.noise_seed).toBe(1234);
			expect(graph["167"]?.inputs?.image).toBe("req-req-42.png");
			// Fallback стоковый SaveImage инжектится поверх VAEDecode (node 364),
			// чтобы ComfyUI не выдавал prompt_no_outputs, даже если кастомный
			// VHS_VideoCombine не зарегистрирован в worker'е.
			expect(graph["9001"]).toBeDefined();
			expect(
				(graph["9001"] as unknown as { class_type: string }).class_type
			).toBe("SaveImage");
			expect(graph["9001"]?.inputs?.images).toEqual(["364", 0]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("bypasses the unknown LoraManager node when no civitai LoRA is provided", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			buildFakeImageResponse()) as unknown as typeof fetch;
		try {
			const wf = createLtx23VideoServerlessWorkflow({
				endpointId: "ep-test",
			});
			const payload = await wf.buildPayload(
				{
					inputImageUrl: "https://example.test/cat.png",
					prompt: "noop",
				},
				{ requestId: "req-bypass" }
			);
			const graph = payload.workflow as Record<
				string,
				{ class_type: string; inputs: Record<string, unknown> }
			>;
			// Узел Lora Manager (366) полностью удалён, чтобы ComfyUI не падал
			// на unknown class.
			expect(graph["366"]).toBeUndefined();
			// Consumer LTX2SamplingPreviewOverride (337) теперь указывает прямо
			// на distill LoRA (134), а не на 366.
			expect(graph["337"]?.inputs?.model).toEqual(["134", 0]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("substitutes the LoraManager node with LoraLoaderModelOnly when civitai LoRA is set", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			buildFakeImageResponse()) as unknown as typeof fetch;
		try {
			const wf = createLtx23VideoServerlessWorkflow({
				endpointId: "ep-test",
			});
			const payload = await wf.buildPayload(
				{
					inputImageUrl: "https://example.test/cat.png",
					loraCivitaiModelId: 12_345,
					loraCivitaiVersionId: 67_890,
					loraScale: 0.85,
					prompt: "with civitai lora",
				},
				{ requestId: "req-civitai" }
			);
			const graph = payload.workflow as Record<
				string,
				{ class_type: string; inputs: Record<string, unknown> }
			>;
			expect(graph["366"]?.class_type).toBe("LoraLoaderModelOnly");
			expect(graph["366"]?.inputs?.lora_name).toBe(
				"civitai-12345-67890.safetensors"
			);
			expect(graph["366"]?.inputs?.strength_model).toBe(0.85);
			// Consumer всё ещё ссылается на 366 (но теперь это валидный node).
			expect(graph["337"]?.inputs?.model).toEqual(["366", 0]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("applies custom base + distill filenames from config", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			buildFakeImageResponse()) as unknown as typeof fetch;
		try {
			const wf = createLtx23VideoServerlessWorkflow({
				baseModelFilename: "diffusion_models/sulphur_dev_fp8mixed.safetensors",
				distillLoraFilename: "loras/sulphur_distil_lora.safetensors",
				endpointId: "ep-test",
			});
			const payload = await wf.buildPayload(
				{
					inputImageUrl: "https://example.test/cat.png",
					prompt: "any",
				},
				{ requestId: "req-x" }
			);
			const graph = payload.workflow as Record<
				string,
				{ inputs: Record<string, unknown> }
			>;
			expect(graph["329"]?.inputs?.unet_name).toBe(
				"diffusion_models/sulphur_dev_fp8mixed.safetensors"
			);
			expect(graph["134"]?.inputs?.lora_name).toBe(
				"loras/sulphur_distil_lora.safetensors"
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("parses serverless worker output (s3_url variant)", () => {
		const wf = createLtx23VideoServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [
				{
					data: "https://s3.test/out.mp4",
					filename: "ComfyUI_00001_.mp4",
					type: "s3_url",
				},
			],
		});
		expect(output.videoUrl).toBe("https://s3.test/out.mp4");
	});

	it("parses serverless worker output (base64 variant) into data URL", () => {
		const wf = createLtx23VideoServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [
				{
					data: "AAAA",
					filename: "out.mp4",
					type: "base64",
				},
			],
		});
		expect(output.videoUrl).toBe("data:video/mp4;base64,AAAA");
	});

	it("throws when worker returns explicit errors", () => {
		const wf = createLtx23VideoServerlessWorkflow({ endpointId: "ep" });
		expect(() =>
			wf.parseOutput({
				errors: ["ComfyUI graph validation failed"],
				images: [],
			})
		).toThrow(VALIDATION_ERROR_PATTERN);
	});

	it("throws when worker returns no images", () => {
		const wf = createLtx23VideoServerlessWorkflow({ endpointId: "ep" });
		expect(() => wf.parseOutput({ images: [] })).toThrow(
			NO_OUTPUT_IMAGES_PATTERN
		);
	});

	it("prefers video output over fallback PNG frames", () => {
		const wf = createLtx23VideoServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [
				{
					data: "iVBORw0KGgo=",
					filename: "ltx-23-frames_00001_.png",
					type: "base64",
				},
				{
					data: "https://s3.test/out.mp4",
					filename: "LTX-23-i2v_00001_.mp4",
					type: "s3_url",
				},
			],
		});
		expect(output.videoUrl).toBe("https://s3.test/out.mp4");
	});

	it("throws when worker only returned PNG frames (VHS_VideoCombine missing)", () => {
		const wf = createLtx23VideoServerlessWorkflow({ endpointId: "ep" });
		expect(() =>
			wf.parseOutput({
				images: [
					{
						data: "iVBORw0KGgo=",
						filename: "ltx-23-frames_00001_.png",
						type: "base64",
					},
				],
			})
		).toThrow(ONLY_IMAGE_OUTPUTS_PATTERN);
	});
});
