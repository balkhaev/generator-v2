import { describe, expect, it } from "bun:test";

import { createFooocusSdxlWorkflow } from "./fooocus-sdxl";

describe("fooocus-sdxl workflow", () => {
	const workflow = createFooocusSdxlWorkflow({ endpointId: "endpoint-x" });

	it("produces a payload matching the Fooocus contract", () => {
		const parsed = workflow.inputSchema.parse({ prompt: "studio portrait" });
		const payload = workflow.buildPayload(parsed);
		expect(payload).toMatchObject({
			api_name: "txt2img",
			prompt: "studio portrait",
			image_number: 1,
			num_inference_steps: 30,
			enable_safety_checker: false,
			require_base64: true,
		});
	});

	it("declares sensible default policy (executionTimeout/ttl)", () => {
		expect(workflow.defaultPolicy).toMatchObject({
			executionTimeout: 5 * 60 * 1000,
			ttl: 30 * 60 * 1000,
		});
	});

	it("does not declare warmup payload by default (rely on min workers >= 1)", () => {
		expect(workflow.warmup).toBeUndefined();
	});

	it("warmup can be opted-in via enableWarmup: true and produces a schema-valid payload", () => {
		const withWarmup = createFooocusSdxlWorkflow({
			endpointId: "endpoint-x",
			enableWarmup: true,
		});
		expect(withWarmup.warmup).toBeDefined();
		const warmInput = withWarmup.warmup?.buildInput();
		const parsed = withWarmup.inputSchema.parse(warmInput);
		expect(parsed.prompt).toBe("warmup");
		expect(parsed.num_inference_steps).toBe(1);
	});

	it("normalizes array outputs into images list", () => {
		const output = workflow.parseOutput([
			{ url: "https://x/y.png", finish_reason: "SUCCESS" },
		]);
		expect(output).toEqual({
			images: [
				{
					base64: undefined,
					dataUrl: undefined,
					finishReason: "SUCCESS",
					url: "https://x/y.png",
				},
			],
		});
	});

	it("normalizes object outputs with image_urls", () => {
		const output = workflow.parseOutput({
			image_urls: ["https://x/a.png", "https://x/b.png"],
		});
		expect(output.images.map((image) => image.url)).toEqual([
			"https://x/a.png",
			"https://x/b.png",
		]);
	});

	it("rejects empty prompts", () => {
		expect(() => workflow.inputSchema.parse({ prompt: "" } as never)).toThrow();
	});
});
