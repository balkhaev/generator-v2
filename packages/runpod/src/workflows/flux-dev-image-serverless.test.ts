import { describe, expect, it } from "bun:test";
import { createFluxDevImageServerlessWorkflow } from "./flux-dev-image-serverless";

const NO_OUTPUT_IMAGES_PATTERN = /no output images/u;

interface GraphNode {
	class_type: string;
	inputs: Record<string, unknown>;
}
type Graph = Record<string, GraphNode>;

function buildGraph(
	config: Parameters<typeof createFluxDevImageServerlessWorkflow>[0],
	input: Parameters<
		ReturnType<typeof createFluxDevImageServerlessWorkflow>["buildPayload"]
	>[0]
): Graph {
	const wf = createFluxDevImageServerlessWorkflow(config);
	const payload = wf.buildPayload(input) as { workflow: Graph };
	return payload.workflow;
}

describe("createFluxDevImageServerlessWorkflow", () => {
	it("declares serverless mode + default policy", () => {
		const wf = createFluxDevImageServerlessWorkflow({ endpointId: "ep-test" });
		expect(wf.mode).toBe("serverless");
		expect(wf.endpointId).toBe("ep-test");
		expect(wf.id).toBe("flux-dev-image");
		expect(wf.warmup).toBeUndefined();
		expect(wf.defaultPolicy?.executionTimeout).toBeGreaterThan(60_000);
	});

	it("declares warmup payload when enableWarmup is true", () => {
		const wf = createFluxDevImageServerlessWorkflow({
			enableWarmup: true,
			endpointId: "ep-test",
		});
		expect(wf.warmup).toBeDefined();
		expect(wf.warmup?.buildInput().prompt).toBe("warmup");
	});

	it("patches prompt, guidance, dimensions, seed and forces flux cfg=1", () => {
		const graph = buildGraph(
			{ endpointId: "ep-test" },
			{
				guidance: 3,
				height: 1152,
				negativePrompt: "low quality",
				prompt: "a grainy snapshot",
				seed: 4242,
				steps: 24,
				width: 896,
			}
		);
		expect(graph["20"]?.inputs?.text).toBe("a grainy snapshot");
		expect(graph["21"]?.inputs?.text).toBe("low quality");
		expect(graph["22"]?.inputs?.guidance).toBe(3);
		expect(graph["30"]?.inputs?.width).toBe(896);
		expect(graph["30"]?.inputs?.height).toBe(1152);
		expect(graph["40"]?.inputs?.seed).toBe(4242);
		expect(graph["40"]?.inputs?.steps).toBe(24);
		expect(graph["40"]?.inputs?.cfg).toBe(1);
	});

	it("snaps non-aligned dimensions to multiples of 16", () => {
		const graph = buildGraph(
			{ endpointId: "ep-test" },
			{ height: 1150, prompt: "x", width: 900 }
		);
		expect((graph["30"]?.inputs?.width as number) % 16).toBe(0);
		expect((graph["30"]?.inputs?.height as number) % 16).toBe(0);
	});

	it("applies custom checkpoint filename from config", () => {
		const graph = buildGraph(
			{ checkpointFilename: "flux_custom.safetensors", endpointId: "ep-test" },
			{ prompt: "x" }
		);
		expect(graph["1"]?.inputs?.ckpt_name).toBe("flux_custom.safetensors");
	});

	it("injects LoRA loader and repoints model+clip when filename provided", () => {
		const graph = buildGraph(
			{ endpointId: "ep-test" },
			{ loraFilename: "noisify.safetensors", loraScale: 0.9, prompt: "x" }
		);
		expect(graph["9101"]?.class_type).toBe("LoraLoader");
		expect(graph["9101"]?.inputs?.lora_name).toBe("noisify.safetensors");
		expect(graph["9101"]?.inputs?.strength_model).toBe(0.9);
		expect(graph["9101"]?.inputs?.strength_clip).toBe(0.9);
		expect(graph["40"]?.inputs?.model).toEqual(["9101", 0]);
		expect(graph["20"]?.inputs?.clip).toEqual(["9101", 1]);
		expect(graph["21"]?.inputs?.clip).toEqual(["9101", 1]);
	});

	it("does not inject LoRA loader when no filename provided", () => {
		const graph = buildGraph({ endpointId: "ep-test" }, { prompt: "noop" });
		expect(graph["9101"]).toBeUndefined();
		expect(graph["40"]?.inputs?.model).toEqual(["1", 0]);
		expect(graph["20"]?.inputs?.clip).toEqual(["1", 1]);
	});

	it("parses serverless output (base64 png) into data url", () => {
		const wf = createFluxDevImageServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [
				{ data: "iVBORw0=", filename: "flux-dev_00001_.png", type: "base64" },
			],
		});
		expect(output.imageUrl).toBe("data:image/png;base64,iVBORw0=");
		expect(output.imageUrls).toHaveLength(1);
	});

	it("parses serverless output (s3_url)", () => {
		const wf = createFluxDevImageServerlessWorkflow({ endpointId: "ep" });
		const output = wf.parseOutput({
			images: [
				{ data: "https://s3.test/out.png", filename: "x.png", type: "s3_url" },
			],
		});
		expect(output.imageUrl).toBe("https://s3.test/out.png");
	});

	it("throws when worker returns no images", () => {
		const wf = createFluxDevImageServerlessWorkflow({ endpointId: "ep" });
		expect(() => wf.parseOutput({ images: [] })).toThrow(
			NO_OUTPUT_IMAGES_PATTERN
		);
	});
});
