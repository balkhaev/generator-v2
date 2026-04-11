import { describe, expect, it } from "bun:test";
import { getWorkflowDefinition } from "./index";

describe("ltx23 workflow defaults", () => {
	it("matches the live ltx23 json controls exposed by the wrapper", () => {
		const workflow = getWorkflowDefinition("ltx-2.3-i2v");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterFields.map((field) => field.key)).toEqual([
			"negativePrompt",
			"guidanceScale",
			"seed",
			"frameRate",
			"numFrames",
			"distilledLoraStrength",
			"styleLora",
			"styleLoraStrength",
		]);
		expect(workflow?.parameterSchema.parse({})).toEqual({
			negativePrompt:
				"pc game, console game, video game, cartoon, childish, ugly",
			guidanceScale: 1,
			frameRate: 24,
			numFrames: 181,
			distilledLoraStrength: 0.5,
			styleLora: "ltx23/DR34ML4Y_LTXXX_PREVIEW_RC1.safetensors",
			styleLoraStrength: 0.8,
		});
	});
});
describe("lustify apex workflow defaults", () => {
	it("accepts an optional LoRA path for SDXL avatar generations", () => {
		const workflow = getWorkflowDefinition("lustify-apex-avatar");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterFields.map((field) => field.key)).toContain(
			"loraPath"
		);
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			guidanceScale: 3.5,
			height: 1216,
			loraStrength: 0.85,
			negativePrompt: "blurry ugly bad",
			steps: 30,
			width: 832,
		});
	});
});
