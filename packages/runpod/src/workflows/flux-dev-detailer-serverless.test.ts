import { describe, expect, it } from "bun:test";
import { createFluxDevDetailerServerlessWorkflow } from "./flux-dev-detailer-serverless";

const NO_OUTPUT_IMAGES_PATTERN = /no output images/u;

interface Node {
	class_type: string;
	inputs: Record<string, unknown>;
}
type Graph = Record<string, Node>;

const SAMPLE_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function buildFakeImageResponse(): typeof fetch {
	return (async () =>
		new Response(SAMPLE_PNG_BYTES, {
			headers: { "content-type": "image/png" },
			status: 200,
		})) as unknown as typeof fetch;
}

async function buildPayload(
	config: Parameters<typeof createFluxDevDetailerServerlessWorkflow>[0],
	input: Parameters<
		ReturnType<typeof createFluxDevDetailerServerlessWorkflow>["buildPayload"]
	>[0],
	requestId: string
): Promise<{ graph: Graph; images: unknown }> {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = buildFakeImageResponse();
	try {
		const wf = createFluxDevDetailerServerlessWorkflow(config);
		const payload = (await wf.buildPayload(input, { requestId })) as {
			images: unknown;
			workflow: Graph;
		};
		return { graph: payload.workflow, images: payload.images };
	} finally {
		globalThis.fetch = originalFetch;
	}
}

describe("createFluxDevDetailerServerlessWorkflow", () => {
	it("declares serverless mode + default policy", () => {
		const wf = createFluxDevDetailerServerlessWorkflow({
			endpointId: "ep-test",
		});
		expect(wf.mode).toBe("serverless");
		expect(wf.endpointId).toBe("ep-test");
		expect(wf.id).toBe("flux-dev-detailer");
		expect(wf.defaultPolicy?.executionTimeout).toBeGreaterThan(0);
	});

	it("builds an img2img graph patched with input image + params", async () => {
		const { graph, images } = await buildPayload(
			{ endpointId: "ep" },
			{
				denoise: 0.5,
				guidance: 3,
				inputImageUrl: "https://example.com/input.png",
				prompt: "add fine detail",
				steps: 18,
				upscaleBy: 1.8,
			},
			"exec-123"
		);
		const loadImage = graph["10"];
		const upscale = graph["11"];
		const posText = graph["20"];
		const ksampler = graph["40"];
		expect(loadImage?.class_type).toBe("LoadImage");
		expect(loadImage?.inputs.image).toBe("detailer-exec-123.png");
		expect(upscale?.inputs.scale_by).toBe(1.8);
		expect(posText?.inputs.text).toBe("add fine detail");
		expect(ksampler?.inputs.denoise).toBe(0.5);
		expect(ksampler?.inputs.steps).toBe(18);
		expect(Array.isArray(images)).toBe(true);
		const first = (images as { image: string; name: string }[])[0];
		expect(first?.name).toBe("detailer-exec-123.png");
		expect(first?.image.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("falls back to a default positive prompt when prompt is empty", async () => {
		const { graph } = await buildPayload(
			{ endpointId: "ep" },
			{ inputImageUrl: "https://example.com/input.png", prompt: "" },
			"exec-empty"
		);
		expect((graph["20"]?.inputs.text as string).length).toBeGreaterThan(0);
	});

	it("clamps denoise and upscale into safe ranges", async () => {
		const { graph } = await buildPayload(
			{ endpointId: "ep" },
			{
				denoise: 5,
				inputImageUrl: "https://example.com/input.png",
				upscaleBy: 9,
			},
			"exec-clamp"
		);
		expect(graph["40"]?.inputs.denoise).toBe(1);
		expect(graph["11"]?.inputs.scale_by).toBe(2);
	});

	it("parses serverless output (base64 png) into a data url", () => {
		const wf = createFluxDevDetailerServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [{ data: "QUJD", filename: "flux-detailer_001.png" }],
		});
		expect(output.imageUrl.startsWith("data:image/png;base64,")).toBe(true);
	});

	it("parses serverless output (s3_url)", () => {
		const wf = createFluxDevDetailerServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [
				{
					data: "https://s3.example.com/out.png",
					filename: "out.png",
					type: "s3_url",
				},
			],
		});
		expect(output.imageUrl).toBe("https://s3.example.com/out.png");
	});

	it("throws when worker returns no images", () => {
		const wf = createFluxDevDetailerServerlessWorkflow({ endpointId: "ep" });
		expect(() => wf.parseOutput({ images: [] })).toThrow(
			NO_OUTPUT_IMAGES_PATTERN
		);
	});
});
