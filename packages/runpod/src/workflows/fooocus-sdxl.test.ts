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
