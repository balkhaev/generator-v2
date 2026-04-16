import { describe, expect, it } from "bun:test";
import { getWorkflowDefinition, listWorkflows } from "@generator/workflows";

const workflowKeyProviderPrefixPattern = /^fal-/;

describe("workflow registry", () => {
	it("lists only fal-prefixed workflows", () => {
		const workflows = listWorkflows();
		expect(workflows.length).toBeGreaterThan(0);
		for (const workflow of workflows) {
			expect(workflow.key).toMatch(workflowKeyProviderPrefixPattern);
		}
	});

	it("builds the fal-zimage-turbo payload", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo");

		expect(
			workflow?.buildProviderInput({
				params: {
					imageSize: "portrait_4_3",
					numInferenceSteps: 8,
					numImages: 1,
					enableSafetyChecker: false,
					outputFormat: "png",
				},
				prompt: "beautiful portrait of a woman, natural skin texture",
			})
		).toMatchObject({
			__falModel: "fal-ai/z-image/turbo",
			prompt: "beautiful portrait of a woman, natural skin texture",
			image_size: "portrait_4_3",
			num_inference_steps: 8,
			num_images: 1,
			enable_safety_checker: false,
			output_format: "png",
		});
	});

	it("builds the fal-zimage-turbo-lora payload with lora config", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo-lora");

		expect(
			workflow?.buildProviderInput({
				params: {
					loraUrl: "https://storage.example.com/my-lora.safetensors",
					loraWeight: 0.8,
				},
				prompt: "portrait photo of my_character, cinematic lighting",
			})
		).toMatchObject({
			__falModel: "fal-ai/z-image/turbo/lora",
			enable_safety_checker: false,
			image_size: "portrait_4_3",
			num_images: 1,
			num_inference_steps: 8,
			output_format: "png",
			prompt: "portrait photo of my_character, cinematic lighting",
			loras: [
				{
					path: "https://storage.example.com/my-lora.safetensors",
					weight: 0.8,
				},
			],
		});
	});

	it("builds the fal-zimage-turbo-lora payload with an optional extra lora", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo-lora");

		expect(
			workflow?.buildProviderInput({
				params: {
					extraLoraUrl: "https://storage.example.com/zit-mystic.safetensors",
					extraLoraWeight: 0.35,
					loraUrl: "https://storage.example.com/my-lora.safetensors",
					loraWeight: 0.8,
				},
				prompt: "portrait photo of my_character, cinematic lighting",
			})
		).toMatchObject({
			__falModel: "fal-ai/z-image/turbo/lora",
			loras: [
				{
					path: "https://storage.example.com/my-lora.safetensors",
					weight: 0.8,
				},
				{
					path: "https://storage.example.com/zit-mystic.safetensors",
					weight: 0.35,
				},
			],
		});
	});

	it("builds the fal-zimage-turbo image-to-image lora payload", () => {
		const workflow = getWorkflowDefinition(
			"fal-zimage-turbo-image-to-image-lora"
		);

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/reference.png",
				params: {
					extraLoraUrl: "https://storage.example.com/zit-mystic.safetensors",
					extraLoraWeight: 0.05,
					loraUrl: "https://storage.example.com/my-lora.safetensors",
					loraWeight: 1,
					strength: 0.95,
				},
				prompt: "a photo of my_character, jumping in a window",
			})
		).toMatchObject({
			__falModel: "fal-ai/z-image/turbo/image-to-image/lora",
			image_url: "https://storage.example.com/reference.png",
			strength: 0.95,
			loras: [
				{
					path: "https://storage.example.com/my-lora.safetensors",
					weight: 1,
				},
				{
					path: "https://storage.example.com/zit-mystic.safetensors",
					weight: 0.05,
				},
			],
		});
	});

	it("builds the fal-flux-dev payload", () => {
		const workflow = getWorkflowDefinition("fal-flux-dev");

		expect(
			workflow?.buildProviderInput({
				params: {
					numInferenceSteps: 28,
					guidanceScale: 3.5,
				},
				prompt: "a sunset over mountains",
			})
		).toMatchObject({
			__falModel: "fal-ai/flux/dev",
			prompt: "a sunset over mountains",
			num_inference_steps: 28,
			guidance_scale: 3.5,
		});
	});

	it("extracts image urls from fal response format", () => {
		const workflow = getWorkflowDefinition("fal-flux-schnell");

		expect(
			workflow?.extractArtifactUrls({
				images: [
					{
						url: "https://v3.fal.media/files/result.png",
						width: 1024,
						height: 1024,
					},
				],
				seed: 42,
			})
		).toEqual(["https://v3.fal.media/files/result.png"]);
	});

	it("returns null for unknown workflow keys", () => {
		expect(getWorkflowDefinition("replicate-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("lustify-apex-avatar")).toBeNull();
		expect(getWorkflowDefinition("nonexistent")).toBeNull();
	});
});
