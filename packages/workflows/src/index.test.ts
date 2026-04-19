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
			enableSafetyChecker: false,
		});
	});

	it("resolves fal-wan-2-2-text-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-wan-2-2-text-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("wan-2-2");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			acceleration: "regular",
			adjustFpsForInterpolation: true,
			aspectRatio: "16:9",
			enableOutputSafetyChecker: false,
			enablePromptExpansion: false,
			enableSafetyChecker: false,
			framesPerSecond: 16,
			guidanceScale: 3.5,
			guidanceScale2: 4,
			interpolatorModel: "film",
			loraScaleHigh: 1,
			loraScaleLow: 1,
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
		expect(workflow?.baseModel).toBe("wan-2-2");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			acceleration: "regular",
			adjustFpsForInterpolation: true,
			aspectRatio: "auto",
			enableOutputSafetyChecker: false,
			enablePromptExpansion: false,
			enableSafetyChecker: false,
			framesPerSecond: 16,
			guidanceScale: 3.5,
			guidanceScale2: 3.5,
			interpolatorModel: "film",
			loraScaleHigh: 1,
			loraScaleLow: 1,
			numFrames: 81,
			numInferenceSteps: 27,
			numInterpolatedFrames: 1,
			resolution: "720p",
			shift: 5,
			videoQuality: "high",
			videoWriteMode: "balanced",
		});
	});

	it("resolves fal-wan-2-7-image-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-wan-2-7-image-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("wan-2-7");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			duration: 5,
			enablePromptExpansion: false,
			enableSafetyChecker: false,
			resolution: "1080p",
		});
	});

	it("resolves fal-seedance-1-5-pro-image-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition(
			"fal-seedance-1-5-pro-image-to-video"
		);
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("seedance-1-5-pro");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			aspectRatio: "16:9",
			cameraFixed: false,
			duration: 5,
			enableSafetyChecker: false,
			generateAudio: true,
			resolution: "720p",
		});
	});

	it("resolves fal-ltx-2-3-text-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-text-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("ltx-2-3");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			enableSafetyChecker: false,
			fps: 24,
			loraScale: 1,
			numFrames: 121,
			numInferenceSteps: 40,
			videoCfgScale: 3,
			videoSize: "landscape_16_9",
		});
	});

	it("resolves fal-ltx-2-3-image-to-video with correct defaults", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-image-to-video");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("ltx-2-3");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			enableSafetyChecker: false,
			fps: 24,
			loraScale: 1,
			numFrames: 121,
			numInferenceSteps: 40,
			videoCfgScale: 3,
			videoSize: "auto",
		});
	});

	it("targets the /lora endpoints for wan and routes loras", () => {
		const wanT2v = getWorkflowDefinition("fal-wan-2-2-text-to-video");
		const wanI2v = getWorkflowDefinition("fal-wan-2-2-image-to-video");
		const buildInput = (
			workflow: ReturnType<typeof getWorkflowDefinition>,
			extra: Record<string, unknown> = {}
		) =>
			workflow?.buildProviderInput({
				params: extra,
				prompt: "test",
				inputImageUrl: "https://example.com/in.jpg",
			}) as Record<string, unknown>;

		expect(buildInput(wanT2v)?.__falModel).toBe(
			"fal-ai/wan/v2.2-a14b/text-to-video/lora"
		);
		expect(buildInput(wanI2v)?.__falModel).toBe(
			"fal-ai/wan/v2.2-a14b/image-to-video/lora"
		);

		// No LoRA → empty loras array.
		expect((buildInput(wanT2v) as { loras: unknown[] }).loras).toEqual([]);

		// High-noise only → single entry routed to the high transformer.
		const wanWithHigh = buildInput(wanT2v, {
			loraUrlHigh: "https://example.com/lora-high.safetensors",
		}) as { loras: unknown[] };
		expect(wanWithHigh.loras).toEqual([
			{
				path: "https://example.com/lora-high.safetensors",
				scale: 1,
				transformer: "high",
			},
		]);

		// Both slots populated → two entries with explicit transformer routing
		// and individual scales.
		const wanWithPair = buildInput(wanT2v, {
			loraUrlHigh: "https://example.com/lora-high.safetensors",
			loraScaleHigh: 0.8,
			loraUrlLow: "https://example.com/lora-low.safetensors",
			loraScaleLow: 0.6,
		}) as { loras: unknown[] };
		expect(wanWithPair.loras).toEqual([
			{
				path: "https://example.com/lora-high.safetensors",
				scale: 0.8,
				transformer: "high",
			},
			{
				path: "https://example.com/lora-low.safetensors",
				scale: 0.6,
				transformer: "low",
			},
		]);
	});

	it("targets the LTX-2.3 /lora endpoints and routes loras", () => {
		const ltxT2v = getWorkflowDefinition("fal-ltx-2-3-text-to-video");
		const ltxI2v = getWorkflowDefinition("fal-ltx-2-3-image-to-video");
		const buildInput = (
			workflow: ReturnType<typeof getWorkflowDefinition>,
			extra: Record<string, unknown> = {}
		) =>
			workflow?.buildProviderInput({
				params: extra,
				prompt: "test",
				inputImageUrl: "https://example.com/in.jpg",
			}) as Record<string, unknown>;

		expect(buildInput(ltxT2v)?.__falModel).toBe(
			"fal-ai/ltx-2.3-22b/text-to-video/lora"
		);
		expect(buildInput(ltxI2v)?.__falModel).toBe(
			"fal-ai/ltx-2.3-22b/image-to-video/lora"
		);

		// Without a LoRA URL we must still send `loras` (fal requires the field)
		// with an empty `path` — exactly as in fal's official example payload.
		expect((buildInput(ltxT2v) as { loras: unknown[] }).loras).toEqual([
			{ path: "", scale: 1 },
		]);

		// With LoRA → single entry with custom scale.
		const ltxWithLora = buildInput(ltxI2v, {
			loraUrl: "https://example.com/ltx-lora.safetensors",
			loraScale: 0.7,
		}) as { loras: unknown[] };
		expect(ltxWithLora.loras).toEqual([
			{ path: "https://example.com/ltx-lora.safetensors", scale: 0.7 },
		]);
	});

	it("marks loraUrl fields as optional in enriched parameter list", () => {
		const workflows = listWorkflows();
		const keys = [
			"fal-flux-dev",
			"fal-zimage-turbo",
			"fal-zimage-turbo-image-to-image",
		];
		for (const key of keys) {
			const workflow = workflows.find((entry) => entry.key === key);
			const loraField = workflow?.parameterFields.find(
				(field) => field.key === "loraUrl"
			);
			expect(loraField?.optional).toBe(true);
			expect(loraField?.kind).toBe("lora-url");
		}
	});

	it("exposes paired high+low lora-url fields for fal-wan-2-2 workflows", () => {
		const workflows = listWorkflows();
		for (const key of [
			"fal-wan-2-2-text-to-video",
			"fal-wan-2-2-image-to-video",
		]) {
			const workflow = workflows.find((entry) => entry.key === key);
			expect(workflow).toBeDefined();
			const high = workflow?.parameterFields.find(
				(field) => field.key === "loraUrlHigh"
			);
			const low = workflow?.parameterFields.find(
				(field) => field.key === "loraUrlLow"
			);
			expect(high?.kind).toBe("lora-url");
			expect(high?.optional).toBe(true);
			expect(low?.kind).toBe("lora-url");
			expect(low?.optional).toBe(true);
			expect(
				workflow?.parameterFields.some((field) => field.key === "loraScaleHigh")
			).toBe(true);
			expect(
				workflow?.parameterFields.some((field) => field.key === "loraScaleLow")
			).toBe(true);
		}
	});

	it("exposes optional LoRA fields in LTX-2.3 parameter UI", () => {
		const workflows = listWorkflows();
		for (const key of [
			"fal-ltx-2-3-text-to-video",
			"fal-ltx-2-3-image-to-video",
		]) {
			const workflow = workflows.find((entry) => entry.key === key);
			const loraField = workflow?.parameterFields.find(
				(field) => field.key === "loraUrl"
			);
			expect(loraField?.optional).toBe(true);
			expect(loraField?.kind).toBe("lora-url");
			expect(
				workflow?.parameterFields.some((field) => field.key === "loraScale")
			).toBe(true);
		}
	});

	it("always targets the /lora endpoints for fal-flux-dev and fal-zimage-turbo", () => {
		const flux = getWorkflowDefinition("fal-flux-dev");
		const zit = getWorkflowDefinition("fal-zimage-turbo");
		const zitI2I = getWorkflowDefinition("fal-zimage-turbo-image-to-image");
		const buildInput = (
			workflow: ReturnType<typeof getWorkflowDefinition>,
			extra: Record<string, unknown> = {}
		) =>
			workflow?.buildProviderInput({
				params: extra,
				prompt: "test",
				inputImageUrl: "https://example.com/in.jpg",
			}) as Record<string, unknown>;

		expect(buildInput(flux)?.__falModel).toBe("fal-ai/flux-lora");
		expect(buildInput(zit)?.__falModel).toBe("fal-ai/z-image/turbo/lora");
		expect(buildInput(zitI2I)?.__falModel).toBe(
			"fal-ai/z-image/turbo/image-to-image/lora"
		);

		// No LoRA → empty loras array.
		expect((buildInput(flux) as { loras: unknown[] }).loras).toEqual([]);
		expect((buildInput(zit) as { loras: unknown[] }).loras).toEqual([]);
		expect((buildInput(zitI2I) as { loras: unknown[] }).loras).toEqual([]);

		// Flux uses scale, Z-Image uses weight.
		const fluxWithLora = buildInput(flux, {
			loraUrl: "https://example.com/flux.safetensors",
			loraScale: 0.5,
		}) as { loras: unknown[] };
		expect(fluxWithLora.loras).toEqual([
			{ path: "https://example.com/flux.safetensors", scale: 0.5 },
		]);

		const zitWithLora = buildInput(zit, {
			loraUrl: "https://example.com/zit.safetensors",
			loraWeight: 0.7,
		}) as { loras: unknown[] };
		expect(zitWithLora.loras).toEqual([
			{ path: "https://example.com/zit.safetensors", weight: 0.7 },
		]);
	});

	it("defaults fal-flux2-dev-edit imageSize to auto", () => {
		const workflow = getWorkflowDefinition("fal-flux2-dev-edit");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			imageSize: "auto",
		});
	});

	it("defaults fal-zimage-turbo-image-to-image imageSize to auto", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo-image-to-image");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			imageSize: "auto",
		});
	});

	it("exposes auto imageSize in enrich for i2i image workflows", () => {
		const workflows = listWorkflows();
		const editWorkflow = workflows.find(
			(workflow) => workflow.key === "fal-flux2-dev-edit"
		);
		const imageSize = editWorkflow?.parameterFields.find(
			(field) => field.key === "imageSize"
		);
		expect(imageSize?.enumValues).toContain("auto");

		const i2i = workflows.find(
			(workflow) => workflow.key === "fal-zimage-turbo-image-to-image"
		);
		const i2iImageSize = i2i?.parameterFields.find(
			(field) => field.key === "imageSize"
		);
		expect(i2iImageSize?.enumValues).toContain("auto");
	});

	it("returns null for legacy or replicate workflow keys", () => {
		expect(getWorkflowDefinition("ltx-2.3-i2v")).toBeNull();
		expect(getWorkflowDefinition("lustify-apex-avatar")).toBeNull();
		expect(getWorkflowDefinition("replicate-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("zib-dpo")).toBeNull();
		expect(getWorkflowDefinition("fal-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("fal-zimage-turbo-lora")).toBeNull();
		expect(
			getWorkflowDefinition("fal-zimage-turbo-image-to-image-lora")
		).toBeNull();
	});
});
