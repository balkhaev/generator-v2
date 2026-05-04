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

	it("builds the fal-zimage-turbo payload without LoRA when no URL is provided", () => {
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
			__falModel: "fal-ai/z-image/turbo/lora",
			prompt: "beautiful portrait of a woman, natural skin texture",
			image_size: "portrait_4_3",
			num_inference_steps: 8,
			num_images: 1,
			enable_safety_checker: false,
			output_format: "png",
			loras: [],
		});
	});

	it("builds the fal-zimage-turbo payload with lora config", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo");

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

	it("builds the fal-zimage-turbo payload with an optional extra lora", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo");

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

	it("builds the fal-zimage-turbo image-to-image payload with optional lora stack", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo-image-to-image");

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

	it("builds the fal-zimage-turbo image-to-image payload without lora", () => {
		const workflow = getWorkflowDefinition("fal-zimage-turbo-image-to-image");

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/reference.png",
				params: { strength: 0.6 },
				prompt: "make it cinematic",
			})
		).toMatchObject({
			__falModel: "fal-ai/z-image/turbo/image-to-image/lora",
			loras: [],
		});
	});

	it("builds the fal-flux-dev payload without LoRA when no URL is provided", () => {
		const workflow = getWorkflowDefinition("fal-flux-dev");

		expect(
			workflow?.buildProviderInput({
				params: { numInferenceSteps: 28 },
				prompt: "a serene mountain lake at sunrise",
			})
		).toMatchObject({
			__falModel: "fal-ai/flux-lora",
			loras: [],
			num_inference_steps: 28,
			prompt: "a serene mountain lake at sunrise",
		});
	});

	it("builds the fal-flux-dev payload with a LoRA URL", () => {
		const workflow = getWorkflowDefinition("fal-flux-dev");

		expect(
			workflow?.buildProviderInput({
				params: {
					loraUrl: "https://storage.example.com/flux-style.safetensors",
					loraScale: 0.7,
				},
				prompt: "portrait of my_character, painterly style",
			})
		).toMatchObject({
			__falModel: "fal-ai/flux-lora",
			loras: [
				{
					path: "https://storage.example.com/flux-style.safetensors",
					scale: 0.7,
				},
			],
		});
	});

	it("builds the fal-fast-sdxl payload with optional LoRA", () => {
		const workflow = getWorkflowDefinition("fal-fast-sdxl");

		expect(
			workflow?.buildProviderInput({
				params: {
					guidanceScale: 8,
					imageSize: "portrait_4_3",
					loraScale: 0.45,
					loraUrl: "https://storage.example.com/sdxl-style.safetensors",
					negativePrompt: "blur, watermark",
					numImages: 2,
					numInferenceSteps: 30,
					outputFormat: "png",
				},
				prompt: "studio portrait of my_character, cinematic lighting",
			})
		).toMatchObject({
			__falModel: "fal-ai/fast-sdxl",
			enable_safety_checker: false,
			expand_prompt: false,
			format: "png",
			guidance_scale: 8,
			image_size: "portrait_4_3",
			loras: [
				{
					path: "https://storage.example.com/sdxl-style.safetensors",
					scale: 0.45,
				},
			],
			negative_prompt: "blur, watermark",
			num_images: 2,
			num_inference_steps: 30,
			prompt: "studio portrait of my_character, cinematic lighting",
		});
	});

	it("builds the fal-fast-fooocus-sdxl payload with optional embedding", () => {
		const workflow = getWorkflowDefinition("fal-fast-fooocus-sdxl");

		expect(
			workflow?.buildProviderInput({
				params: {
					embeddingTokens: "fooocus_style, subject_token",
					enableRefiner: "false",
					guidanceScale: 2.5,
					imageSize: "portrait_4_3",
					loraUrl: "https://storage.example.com/fooocus.safetensors",
					negativePrompt: "blur, watermark",
					numImages: 2,
					numInferenceSteps: 12,
					outputFormat: "png",
				},
				prompt: "studio portrait of my_character, cinematic lighting",
			})
		).toMatchObject({
			__falModel: "fal-ai/fast-fooocus-sdxl",
			embeddings: [
				{
					path: "https://storage.example.com/fooocus.safetensors",
					tokens: ["fooocus_style", "subject_token"],
				},
			],
			enable_refiner: false,
			enable_safety_checker: false,
			expand_prompt: true,
			format: "png",
			guidance_scale: 2.5,
			image_size: "portrait_4_3",
			negative_prompt: "blur, watermark",
			num_images: 2,
			num_inference_steps: 12,
			prompt: "studio portrait of my_character, cinematic lighting",
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

	it("builds the fal-flux-dev payload with guidance and no LoRA", () => {
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
			__falModel: "fal-ai/flux-lora",
			prompt: "a sunset over mountains",
			num_inference_steps: 28,
			guidance_scale: 3.5,
			loras: [],
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
			__falModel: "fal-ai/wan/v2.2-a14b/text-to-video/lora",
			aspect_ratio: "16:9",
			frames_per_second: 16,
			guidance_scale: 3.5,
			guidance_scale_2: 4,
			loras: [],
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
					loraScaleHigh: 0.8,
					loraScaleLow: 0.6,
					loraUrlHigh: "https://storage.example.com/wan-lora-high.safetensors",
					loraUrlLow: "https://storage.example.com/wan-lora-low.safetensors",
					numFrames: 81,
					numInferenceSteps: 27,
					resolution: "720p",
					shift: 5,
				},
				prompt: "the subject turns toward camera as the light changes",
			})
		).toMatchObject({
			__falModel: "fal-ai/wan/v2.2-a14b/image-to-video/lora",
			aspect_ratio: "auto",
			end_image_url: "https://storage.example.com/end-frame.png",
			frames_per_second: 16,
			guidance_scale: 3.5,
			guidance_scale_2: 3.5,
			image_url: "https://storage.example.com/reference.png",
			loras: [
				{
					path: "https://storage.example.com/wan-lora-high.safetensors",
					scale: 0.8,
					transformer: "high",
				},
				{
					path: "https://storage.example.com/wan-lora-low.safetensors",
					scale: 0.6,
					transformer: "low",
				},
			],
			num_frames: 81,
			num_inference_steps: 27,
			prompt: "the subject turns toward camera as the light changes",
			resolution: "720p",
			shift: 5,
			video_quality: "high",
			video_write_mode: "balanced",
		});
	});

	it("builds the fal-wan-2-7 image-to-video payload", () => {
		const workflow = getWorkflowDefinition("fal-wan-2-7-image-to-video");

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/first.png",
				params: {
					audioUrl: "https://storage.example.com/voice.mp3",
					duration: 8,
					endImageUrl: "https://storage.example.com/last.png",
					negativePrompt: "blur",
					resolution: "720p",
				},
				prompt: "slow dolly forward",
			})
		).toMatchObject({
			__falModel: "fal-ai/wan/v2.7/image-to-video",
			audio_url: "https://storage.example.com/voice.mp3",
			duration: 8,
			end_image_url: "https://storage.example.com/last.png",
			enable_prompt_expansion: false,
			enable_safety_checker: false,
			image_url: "https://storage.example.com/first.png",
			negative_prompt: "blur",
			prompt: "slow dolly forward",
			resolution: "720p",
		});
	});

	it("builds the fal-seedance-1-5-pro image-to-video payload", () => {
		const workflow = getWorkflowDefinition(
			"fal-seedance-1-5-pro-image-to-video"
		);

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/start.png",
				params: {
					aspectRatio: "9:16",
					cameraFixed: true,
					duration: 8,
					endImageUrl: "https://storage.example.com/end.png",
					resolution: "1080p",
					seed: -1,
				},
				prompt: "slow orbit around the subject",
			})
		).toMatchObject({
			__falModel: "fal-ai/bytedance/seedance/v1.5/pro/image-to-video",
			aspect_ratio: "9:16",
			camera_fixed: true,
			duration: 8,
			end_image_url: "https://storage.example.com/end.png",
			enable_safety_checker: false,
			generate_audio: true,
			image_url: "https://storage.example.com/start.png",
			prompt: "slow orbit around the subject",
			resolution: "1080p",
			seed: -1,
		});
	});

	it("builds the fal-ltx-2-3 text-to-video payload with empty loras when no URL provided", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-text-to-video");

		expect(
			workflow?.buildProviderInput({
				params: {
					fps: 24,
					numFrames: 121,
					numInferenceSteps: 40,
					videoSize: "landscape_16_9",
				},
				prompt: "a fast handheld shot through a busy market",
			})
		).toMatchObject({
			__falModel: "fal-ai/ltx-2.3-22b/text-to-video/lora",
			enable_safety_checker: false,
			fps: 24,
			generate_audio: true,
			loras: [{ path: "", scale: 1 }],
			num_frames: 121,
			num_inference_steps: 40,
			prompt: "a fast handheld shot through a busy market",
			video_cfg_scale: 3,
			video_size: "landscape_16_9",
		});
	});

	it("builds the fal-ltx-2-3 image-to-video payload with optional LoRA", () => {
		const workflow = getWorkflowDefinition("fal-ltx-2-3-image-to-video");

		const payload = workflow?.buildProviderInput({
			inputImageUrl: "https://storage.example.com/reference.png",
			params: {
				endImageUrl: "",
				fps: 24,
				loraScale: 0.5,
				loraUrl: "https://storage.example.com/ltx-lora.safetensors",
				numFrames: 121,
				numInferenceSteps: 40,
				videoSize: "auto",
			},
			prompt: "animate the still image with a slow dolly push",
		});

		expect(payload).toMatchObject({
			__falModel: "fal-ai/ltx-2.3-22b/image-to-video/lora",
			enable_safety_checker: false,
			fps: 24,
			generate_audio: true,
			image_url: "https://storage.example.com/reference.png",
			loras: [
				{
					path: "https://storage.example.com/ltx-lora.safetensors",
					scale: 0.5,
				},
			],
			num_frames: 121,
			num_inference_steps: 40,
			prompt: "animate the still image with a slow dolly push",
			video_cfg_scale: 3,
			video_size: "auto",
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
