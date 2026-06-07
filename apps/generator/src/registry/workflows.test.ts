import { describe, expect, it } from "bun:test";
import { getWorkflowDefinition, listWorkflows } from "@generator/workflows";

const workflowKeyProviderPrefixPattern = /^(civitai|replicate|runpod)-/;

describe("workflow registry", () => {
	it("lists only provider-prefixed workflows", () => {
		const workflows = listWorkflows();
		expect(workflows.length).toBeGreaterThan(0);
		for (const workflow of workflows) {
			expect(workflow.key).toMatch(workflowKeyProviderPrefixPattern);
		}
	});

	it("builds the replicate-flux-dev-lora payload with disable_safety_checker default", () => {
		const workflow = getWorkflowDefinition("replicate-flux-dev-lora");

		expect(
			workflow?.buildProviderInput({
				params: {
					imageSize: "portrait_16_9",
					numInferenceSteps: 28,
					guidanceScale: 3.5,
				},
				prompt: "a serene mountain lake at sunrise",
			})
		).toMatchObject({
			__replicateVersion:
				"ae0d7d645446924cf1871e3ca8796e8318f72465d2b5af9323a835df93bf0917",
			aspect_ratio: "9:16",
			disable_safety_checker: true,
			go_fast: false,
			guidance: 3.5,
			num_inference_steps: 28,
			num_outputs: 1,
			prompt: "a serene mountain lake at sunrise",
		});
	});

	it("builds the replicate-flux-dev-lora payload with a LoRA URL", () => {
		const workflow = getWorkflowDefinition("replicate-flux-dev-lora");

		expect(
			workflow?.buildProviderInput({
				params: {
					imageSize: "portrait_16_9",
					loraScale: 1,
					loraUrl: "https://storage.example.com/flux-style.safetensors",
				},
				prompt: "portrait of my_character, painterly style",
			})
		).toMatchObject({
			__replicateVersion:
				"ae0d7d645446924cf1871e3ca8796e8318f72465d2b5af9323a835df93bf0917",
			aspect_ratio: "9:16",
			disable_safety_checker: true,
			lora_scale: 1,
			lora_weights: "https://storage.example.com/flux-style.safetensors",
		});
	});

	it("builds the runpod-fooocus-sdxl payload with optional LoRAs", () => {
		const workflow = getWorkflowDefinition("runpod-fooocus-sdxl");

		expect(
			workflow?.buildProviderInput({
				params: {
					enableRefiner: "false",
					extraLoraUrl: "https://storage.example.com/style.safetensors",
					extraLoraWeight: 0.3,
					guidanceScale: 4.5,
					imageSize: "portrait_4_3",
					loraUrl: "https://storage.example.com/subject.safetensors",
					loraWeight: 0.9,
					negativePrompt: "blur, watermark",
					numImages: 2,
					numInferenceSteps: 32,
					outputFormat: "png",
				},
				prompt: "studio portrait of my_character, cinematic lighting",
			})
		).toMatchObject({
			__runpodWorkflow: "fooocus-sdxl",
			advanced_params: {
				overwrite_step: 32,
			},
			api_name: "txt2img",
			aspect_ratios_selection: "896*1152",
			base_model_name: "juggernautXL_version6Rundiffusion.safetensors",
			enable_refiner: false,
			enable_safety_checker: false,
			guidance_scale: 4.5,
			image_number: 2,
			image_size: "portrait_4_3",
			loras: [
				{
					model_name: "subject.safetensors",
					url: "https://storage.example.com/subject.safetensors",
					weight: 0.9,
				},
				{
					model_name: "style.safetensors",
					url: "https://storage.example.com/style.safetensors",
					weight: 0.3,
				},
			],
			loras_custom_urls:
				"https://storage.example.com/subject.safetensors,0.9;https://storage.example.com/style.safetensors,0.3",
			negative_prompt: "blur, watermark",
			num_images: 2,
			num_inference_steps: 32,
			output_format: "png",
			prompt: "studio portrait of my_character, cinematic lighting",
			refiner_model_name: "None",
			refiner_switch: 0.5,
			require_base64: true,
		});
	});

	it("builds the civitai-lustify-olt-sdxl payload", () => {
		const workflow = getWorkflowDefinition("civitai-lustify-olt-sdxl");

		expect(
			workflow?.buildProviderInput({
				params: {
					cfgScale: 4,
					height: 1216,
					negativePrompt: "blur, watermark",
					numImages: 2,
					scheduler: "EulerA",
					steps: 30,
					width: 832,
				},
				prompt: "studio portrait of my_character, cinematic lighting",
			})
		).toMatchObject({
			__civitaiModel: "urn:air:sdxl:checkpoint:civitai:573152@1569593",
			$type: "textToImage",
			baseModel: "SDXL",
			model: "urn:air:sdxl:checkpoint:civitai:573152@1569593",
			params: {
				cfgScale: 4,
				clipSkip: 2,
				height: 1216,
				negativePrompt: "blur, watermark",
				prompt: "studio portrait of my_character, cinematic lighting",
				scheduler: "EulerA",
				steps: 30,
				width: 832,
			},
			quantity: 2,
		});
	});

	it("builds the Civitai LTX-2.3 synth LoRA video payload", () => {
		const workflow = getWorkflowDefinition(
			"civitai-ltx-2-3-synth-text-to-video"
		);

		expect(
			workflow?.buildProviderInput({
				params: {
					aspectRatio: "3:2",
					duration: 20,
					guidanceScale: 4,
					loraAir: "urn:air:ltxv23:lora:civitai:2487612@2800000",
					loraStrength: 0.8,
					resolution: "1080p",
					steps: 32,
				},
				prompt: "slow camera push through the scene",
			})
		).toMatchObject({
			__civitaiEndpoint: "ltx2.3:synth-lora:createVideo",
			$type: "videoGen",
			input: {
				engine: "ltx2.3",
				operation: "createVideo",
				prompt: "slow camera push through the scene",
				width: 1764,
				height: 1176,
				model: "22b-dev",
				guidanceScale: 4,
				steps: 32,
				duration: 20,
				generateAudio: false,
				loras: {
					"urn:air:ltxv23:lora:civitai:2487612@2800000": 0.8,
				},
			},
		});
	});

	it("builds the replicate-fooocus-sdxl payload with optional LoRAs", () => {
		const workflow = getWorkflowDefinition("replicate-fooocus-sdxl");

		expect(
			workflow?.buildProviderInput({
				params: {
					extraLoraUrl: "https://storage.example.com/style.safetensors",
					extraLoraWeight: 0.3,
					guidanceScale: 4.5,
					imageSize: "portrait_4_3",
					loraUrl: "https://storage.example.com/subject.safetensors",
					loraWeight: 0.9,
					negativePrompt: "blur, watermark",
					numImages: 2,
					performanceSelection: "Quality",
					useDefaultLoras: "true",
				},
				prompt: "studio portrait of my_character, cinematic lighting",
			})
		).toMatchObject({
			__replicateVersion:
				"bd7d45104209dc3e1e2765d364697f1393a92a210a0e47fdf943afbd2271a48c",
			aspect_ratios_selection: "896*1152",
			guidance_scale: 4.5,
			image_number: 2,
			image_seed: -1,
			loras_custom_urls:
				"https://storage.example.com/subject.safetensors,0.9;https://storage.example.com/style.safetensors,0.3",
			negative_prompt: "blur, watermark",
			performance_selection: "Quality",
			prompt: "studio portrait of my_character, cinematic lighting",
			refiner_switch: 0.5,
			sharpness: 2,
			style_selections: "Fooocus V2,Fooocus Enhance,Fooocus Sharp",
			use_default_loras: true,
		});
	});

	it("builds the replicate-wan-2-2 fast text-to-video payload", () => {
		const workflow = getWorkflowDefinition(
			"replicate-wan-2-2-fast-text-to-video"
		);

		expect(
			workflow?.buildProviderInput({
				params: {
					aspectRatio: "9:16",
					framesPerSecond: 24,
					interpolateOutput: "false",
					loraScaleHigh: 0.8,
					loraScaleLow: 0.6,
					loraUrlHigh: "https://storage.example.com/wan-high.safetensors",
					loraUrlLow: "https://storage.example.com/wan-low.safetensors",
					numFrames: 121,
					optimizePrompt: "true",
					resolution: "720p",
					sampleShift: 10,
				},
				prompt: "a cinematic tracking shot across a rainy neon street",
			})
		).toMatchObject({
			__replicateVersion:
				"c483b1f7b892065bc58ebadb6381abf557f6b1f517d2ff0febb3fb635cf49b4d",
			aspect_ratio: "9:16",
			disable_safety_checker: true,
			frames_per_second: 24,
			interpolate_output: false,
			lora_scale_transformer: 0.8,
			lora_scale_transformer_2: 0.6,
			lora_weights_transformer:
				"https://storage.example.com/wan-high.safetensors",
			lora_weights_transformer_2:
				"https://storage.example.com/wan-low.safetensors",
			num_frames: 121,
			optimize_prompt: true,
			prompt: "a cinematic tracking shot across a rainy neon street",
			resolution: "720p",
			sample_shift: 10,
		});
	});

	it("builds the replicate-wan-2-2 fast image-to-video payload", () => {
		const workflow = getWorkflowDefinition(
			"replicate-wan-2-2-fast-image-to-video"
		);

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/start.png",
				params: {
					endImageUrl: "https://storage.example.com/end.png",
					framesPerSecond: 16,
					interpolateOutput: "true",
					numFrames: 81,
					resolution: "480p",
					sampleShift: 12,
				},
				prompt: "the subject turns toward camera as the light changes",
			})
		).toMatchObject({
			__replicateVersion:
				"4eaf2b01d3bf70d8a2e00b219efeb7cb415855ad18b7dacdc4cae664a73a6eea",
			disable_safety_checker: true,
			frames_per_second: 16,
			image: "https://storage.example.com/start.png",
			interpolate_output: true,
			last_image: "https://storage.example.com/end.png",
			num_frames: 81,
			prompt: "the subject turns toward camera as the light changes",
			resolution: "480p",
			sample_shift: 12,
		});
	});

	it("builds the runpod-voxcpm-tts payload from prompt text", () => {
		const workflow = getWorkflowDefinition("runpod-voxcpm-tts");

		expect(
			workflow?.buildProviderInput({
				params: {},
				prompt: "Привет, это синтез речи.",
			})
		).toEqual({
			__runpodWorkflow: "tts-voxcpm",
			text: "Привет, это синтез речи.",
		});
	});

	it("builds the runpod-voxcpm-tts payload with reference voice and style", () => {
		const workflow = getWorkflowDefinition("runpod-voxcpm-tts");

		expect(
			workflow?.buildProviderInput({
				params: {
					referenceAudioUrl: "https://cdn.example.com/voice.wav",
					referenceText: "reference transcript",
					style: "warm calm female",
				},
				prompt: "Текст для озвучки",
			})
		).toMatchObject({
			__runpodWorkflow: "tts-voxcpm",
			text: "Текст для озвучки",
			referenceAudioUrl: "https://cdn.example.com/voice.wav",
			referenceText: "reference transcript",
			style: "warm calm female",
		});
	});

	it("routes the runpod-higgs-tts payload to the higgs worker", () => {
		const workflow = getWorkflowDefinition("runpod-higgs-tts");

		expect(
			workflow?.buildProviderInput({
				params: {},
				prompt: "Experimental Higgs voice",
			})
		).toMatchObject({
			__runpodWorkflow: "tts-higgs",
			text: "Experimental Higgs voice",
		});
	});

	it("extracts audio urls from runpod tts s3_url output", () => {
		const workflow = getWorkflowDefinition("runpod-voxcpm-tts");

		expect(
			workflow?.extractArtifactUrls({
				audio: [
					{
						filename: "voxcpm-1.wav",
						type: "s3_url",
						data: "https://generator.example.com/tts/voxcpm-1.wav",
					},
				],
			})
		).toEqual(["https://generator.example.com/tts/voxcpm-1.wav"]);
	});

	it("extracts audio urls from runpod tts normalized audioUrl output", () => {
		const workflow = getWorkflowDefinition("runpod-voxcpm-tts");

		expect(
			workflow?.extractArtifactUrls({
				audioUrl: "https://generator.example.com/tts/voxcpm-2.wav",
			})
		).toEqual(["https://generator.example.com/tts/voxcpm-2.wav"]);
	});

	it("returns null for unknown or removed workflow keys", () => {
		expect(getWorkflowDefinition("replicate-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("lustify-apex-avatar")).toBeNull();
		expect(getWorkflowDefinition("nonexistent")).toBeNull();
		expect(getWorkflowDefinition("fal-flux-dev")).toBeNull();
		expect(getWorkflowDefinition("fal-zimage-turbo")).toBeNull();
	});
});
