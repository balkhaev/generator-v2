import { describe, expect, it } from "bun:test";

import { getWorkflowDefinition, listWorkflows } from "./index";

const workflowKeyProviderPrefixPattern = /^fal-/;

describe("fal workflow registry", () => {
	it("exposes only fal-prefixed workflows", () => {
		const workflows = listWorkflows();
		expect(workflows.length).toBeGreaterThan(0);
		for (const workflow of workflows) {
			expect(workflow.key).toMatch(workflowKeyProviderPrefixPattern);
		}
	});

	it("resolves fal-zimage-turbo with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			imageSize: "portrait_4_3",
			numInferenceSteps: 8,
			numImages: 1,
			enableSafetyChecker: false,
			outputFormat: "png",
		});
	});

	it("resolves fal-flux-dev with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-flux-dev");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			imageSize: "landscape_4_3",
			numInferenceSteps: 28,
			guidanceScale: 3.5,
			numImages: 1,
			enableSafetyChecker: true,
		});
	});

	it("resolves fal-wan-2-2-text-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-wan-2-2-text-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			acceleration: "regular",
			adjustFpsForInterpolation: true,
			aspectRatio: "16:9",
			enableOutputSafetyChecker: false,
			enablePromptExpansion: false,
			enableSafetyChecker: true,
			framesPerSecond: 16,
			guidanceScale: 3.5,
			guidanceScale2: 4,
			interpolatorModel: "film",
			numFrames: 81,
			numInferenceSteps: 27,
			numInterpolatedFrames: 1,
			resolution: "720p",
			shift: 5,
			videoQuality: "high",
			videoWriteMode: "balanced",
		});
	});

	it("resolves fal-wan-2-2-image-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-wan-2-2-image-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			acceleration: "regular",
			adjustFpsForInterpolation: true,
			aspectRatio: "auto",
			enableOutputSafetyChecker: false,
			enablePromptExpansion: false,
			enableSafetyChecker: true,
			framesPerSecond: 16,
			guidanceScale: 3.5,
			guidanceScale2: 3.5,
			interpolatorModel: "film",
			numFrames: 81,
			numInferenceSteps: 27,
			numInterpolatedFrames: 1,
			resolution: "720p",
			shift: 5,
			videoQuality: "high",
			videoWriteMode: "balanced",
		});
	});

	it("resolves fal-ltx-2-3-text-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-text-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			aspectRatio: "16:9",
			duration: 6,
			fps: 25,
			generateAudio: true,
			resolution: "1080p",
		});
	});

	it("resolves fal-ltx-2-3-image-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-image-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			aspectRatio: "auto",
			duration: 6,
			fps: 25,
			generateAudio: true,
			resolution: "1080p",
		});
	});

	it("returns null for removed replicate workflows", () => {
		expect(getWorkflowDefinition("ltx-2.3-i2v")).toBeNull();
		expect(getWorkflowDefinition("lustify-apex-avatar")).toBeNull();
		expect(getWorkflowDefinition("replicate-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("zib-dpo")).toBeNull();
	});
});
