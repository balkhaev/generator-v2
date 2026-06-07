import { describe, expect, it } from "bun:test";

import { buildCreateScenarioInput, type WorkflowDefinition } from "./shared";

describe("studio shared scenario inputs", () => {
	it("omits empty optional parameters", () => {
		const workflow: WorkflowDefinition = {
			active: true,
			baseModel: "ltx-2-3",
			key: "runpod-ltx-2-3-image-to-video",
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

	it("keeps prompt source only while it matches the enhanced prompt", () => {
		const workflow: WorkflowDefinition = {
			active: true,
			key: "runpod-flux-dev-image",
			name: "Flux Dev Image",
			parameters: [],
			promptHint: "Describe image",
			requiresInputImage: false,
			summary: "Text-to-image generation.",
		};

		const promptSource = {
			enhancedPrompt: "cinematic portrait, soft window light",
			mode: "text" as const,
			originalPrompt: "portrait",
		};

		expect(
			buildCreateScenarioInput(workflow, {
				name: "Enhanced",
				params: {},
				prompt: promptSource.enhancedPrompt,
				promptSource,
				workflowKey: workflow.key,
			}).promptSource
		).toEqual(promptSource);

		expect(
			buildCreateScenarioInput(workflow, {
				name: "Edited",
				params: {},
				prompt: "manual edit",
				promptSource,
				workflowKey: workflow.key,
			}).promptSource
		).toBeNull();
	});
});
