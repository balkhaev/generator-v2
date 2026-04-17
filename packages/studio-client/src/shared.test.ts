import { describe, expect, it } from "bun:test";

import { buildCreateScenarioInput, type WorkflowDefinition } from "./shared";

describe("studio shared scenario inputs", () => {
	it("omits empty optional parameters", () => {
		const workflow: WorkflowDefinition = {
			baseModel: "ltx",
			key: "fal-ltx-2-3-image-to-video",
			name: "LTX 2.3 I2V",
			parameters: [
				{
					defaultValue: "",
					helperText: "Optional ending frame URL.",
					key: "endImageUrl",
					label: "End image URL",
					optional: true,
					type: "text",
				},
				{
					defaultValue: "6",
					helperText: "Generated clip length in seconds.",
					key: "duration",
					label: "Duration",
					type: "number",
				},
			],
			promptHint: "Describe motion",
			requiresInputImage: true,
			summary: "Image-to-video generation.",
		};

		expect(
			buildCreateScenarioInput(workflow, {
				name: "Test I2V",
				params: {
					duration: "6",
					endImageUrl: "",
				},
				prompt: "Animate this frame",
				workflowKey: workflow.key,
			}).params
		).toEqual({ duration: 6 });
	});
});
