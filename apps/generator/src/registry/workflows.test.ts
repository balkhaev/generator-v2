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

	it("omits image_size for fal-flux2-dev-edit when set to auto", () => {
		const workflow = getWorkflowDefinition("fal-flux2-dev-edit");

		const result = workflow?.buildProviderInput({
			inputImageUrl: "https://storage.example.com/source.png",
			params: {
				imageSize: "auto",
			},
			prompt: "make it cinematic",
		});

		expect(result).toMatchObject({
			__falModel: "fal-ai/flux-2/edit",
			image_urls: ["https://storage.example.com/source.png"],
		});
		expect(result).not.toHaveProperty("image_size");
	});

	it("passes explicit image_size for fal-flux2-dev-edit when not auto", () => {
		const workflow = getWorkflowDefinition("fal-flux2-dev-edit");

		const result = workflow?.buildProviderInput({
			inputImageUrl: "https://storage.example.com/source.png",
			params: {
				imageSize: "landscape_16_9",
			},
			prompt: "make it cinematic",
		});

		expect(result).toMatchObject({
			image_size: "landscape_16_9",
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

	it("builds the fal-wan-2-2 text-to-video payload", () => {
		const workflow = getWorkflowDefinition("fal-wan-2-2-text-to-video");

		expect(
			workflow?.buildProviderInput({
				params: {
					aspectRatio: "16:9",
					framesPerSecond: 16,
					guidanceScale: 3.5,
					guidanceScale2: 4,
					numFrames: 81,
					numInferenceSteps: 27,
					resolution: "720p",
					shift: 5,
				},
				prompt: "a cinematic tracking shot across a rainy neon street",
			})
		).toMatchObject({
			__falModel: "fal-ai/wan/v2.2-a14b/text-to-video",
			aspect_ratio: "16:9",
			frames_per_second: 16,
			guidance_scale: 3.5,
			guidance_scale_2: 4,
			num_frames: 81,
			num_inference_steps: 27,
			prompt: "a cinematic tracking shot across a rainy neon street",
			resolution: "720p",
			shift: 5,
			video_quality: "high",
			video_write_mode: "balanced",
		});
	});

	it("builds the fal-wan-2-2 image-to-video payload", () => {
		const workflow = getWorkflowDefinition("fal-wan-2-2-image-to-video");

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/reference.png",
				params: {
					aspectRatio: "auto",
					endImageUrl: "https://storage.example.com/end-frame.png",
					framesPerSecond: 16,
					guidanceScale: 3.5,
					guidanceScale2: 3.5,
					numFrames: 81,
					numInferenceSteps: 27,
					resolution: "720p",
					shift: 5,
				},
				prompt: "the subject turns toward camera as the light changes",
			})
		).toMatchObject({
			__falModel: "fal-ai/wan/v2.2-a14b/image-to-video",
			aspect_ratio: "auto",
			end_image_url: "https://storage.example.com/end-frame.png",
			frames_per_second: 16,
			guidance_scale: 3.5,
			guidance_scale_2: 3.5,
			image_url: "https://storage.example.com/reference.png",
			num_frames: 81,
			num_inference_steps: 27,
			prompt: "the subject turns toward camera as the light changes",
			resolution: "720p",
			shift: 5,
			video_quality: "high",
			video_write_mode: "balanced",
		});
	});

	it("builds the fal-ltx-2-3 text-to-video payload", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-text-to-video");

		expect(
			workflow?.buildProviderInput({
				params: {
					aspectRatio: "16:9",
					duration: 6,
					fps: 25,
					resolution: "1080p",
				},
				prompt: "a fast handheld shot through a busy market",
			})
		).toMatchObject({
			__falModel: "fal-ai/ltx-2.3/text-to-video",
			aspect_ratio: "16:9",
			duration: 6,
			fps: 25,
			generate_audio: true,
			prompt: "a fast handheld shot through a busy market",
			resolution: "1080p",
		});
	});

	it("builds the fal-ltx-2-3 image-to-video payload", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-image-to-video");

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/reference.png",
				params: {
					aspectRatio: "auto",
					duration: 6,
					endImageUrl: "",
					fps: 25,
					resolution: "1080p",
				},
				prompt: "animate the still image with a slow dolly push",
			})
		).toMatchObject({
			__falModel: "fal-ai/ltx-2.3/image-to-video",
			aspect_ratio: "auto",
			duration: 6,
			fps: 25,
			generate_audio: true,
			image_url: "https://storage.example.com/reference.png",
			prompt: "animate the still image with a slow dolly push",
			resolution: "1080p",
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

	it("extracts video urls from fal response format", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-text-to-video");

		expect(
			workflow?.extractArtifactUrls({
				video: {
					content_type: "video/mp4",
					url: "https://v3b.fal.media/files/result.mp4",
				},
			})
		).toEqual(["https://v3b.fal.media/files/result.mp4"]);
	});

	it("returns null for unknown workflow keys", () => {
		expect(getWorkflowDefinition("replicate-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("lustify-apex-avatar")).toBeNull();
		expect(getWorkflowDefinition("nonexistent")).toBeNull();
	});
});
