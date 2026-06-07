import { describe, expect, it } from "bun:test";

import { getWorkflowDefinition, listWorkflows } from "./index";

const workflowKeyProviderPrefixPattern = /^(civitai|replicate|runpod)-/;

describe("workflow registry", () => {
	it("exposes only provider-prefixed workflows", () => {
		const workflows = listWorkflows();
		expect(workflows.length).toBeGreaterThan(0);
		for (const workflow of workflows) {
			expect(workflow.key).toMatch(workflowKeyProviderPrefixPattern);
		}
	});

	it("no longer exposes any fal-* workflows", () => {
		const workflows = listWorkflows();
		expect(
			workflows.every((workflow) => !workflow.key.startsWith("fal-"))
		).toBe(true);
	});

	it("resolves replicate-flux-dev-lora with correct defaults", () => {
		const workflow = getWorkflowDefinition("replicate-flux-dev-lora");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("flux");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			disableSafetyChecker: true,
			extraLoraScale: 0.5,
			goFast: false,
			guidanceScale: 3.5,
			imageSize: "landscape_4_3",
			loraScale: 1,
			megapixels: "1",
			numImages: 1,
			numInferenceSteps: 28,
			outputFormat: "jpg",
		});
	});

	it("resolves runpod-fooocus-sdxl with correct defaults", () => {
		const workflow = getWorkflowDefinition("runpod-fooocus-sdxl");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("sdxl");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			baseModelName: "juggernautXL_version6Rundiffusion.safetensors",
			enableRefiner: true,
			extraLoraWeight: 0.5,
			guidanceScale: 4,
			imageSize: "square_hd",
			loraWeight: 1,
			negativePrompt: "",
			numImages: 1,
			numInferenceSteps: 30,
			outputFormat: "jpeg",
		});
	});

	it("resolves runpod-ltx-2-3 workflows with correct defaults", () => {
		const i2v = getWorkflowDefinition("runpod-ltx-2-3-image-to-video");
		const legacy = getWorkflowDefinition("runpod-ltx-2-3-synth-text-to-video");
		const t2vLegacy = getWorkflowDefinition("runpod-ltx-2-3-text-to-video");
		const listedKeys = listWorkflows().map((workflow) => workflow.key);

		expect(i2v).toBeDefined();
		expect(legacy).toBeDefined();
		expect(t2vLegacy).toBeDefined();
		expect(i2v?.baseModel).toBe("ltx-2-3");
		expect(i2v?.requiresInputImage).toBe(true);
		expect(listedKeys).toContain("runpod-ltx-2-3-image-to-video");
		expect(listedKeys).not.toContain("runpod-ltx-2-3-text-to-video");
		expect(listedKeys).not.toContain("runpod-ltx-2-3-synth-text-to-video");

		const defaults = i2v?.parameterSchema.parse({}) as
			| Record<string, unknown>
			| undefined;
		expect(defaults).toMatchObject({
			cfgScale: 1,
			durationSeconds: 10,
			fps: 24,
			height: 1280,
			loraScale: 0.7,
			steps: 8,
			width: 896,
		});
		expect(defaults?.loraCivitaiModelId).toBeUndefined();
		expect(defaults?.loraCivitaiVersionId).toBeUndefined();
	});

	it("resolves civitai-lustify-olt-sdxl with correct defaults", () => {
		const workflow = getWorkflowDefinition("civitai-lustify-olt-sdxl");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("sdxl");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			cfgScale: 3.5,
			clipSkip: 2,
			height: 1216,
			negativePrompt: "",
			numImages: 1,
			scheduler: "DPM2MKarras",
			steps: 30,
			width: 832,
		});
	});

	it("resolves civitai-ltx-2-3 synth workflows with correct defaults", () => {
		const t2v = getWorkflowDefinition("civitai-ltx-2-3-synth-text-to-video");
		const i2v = getWorkflowDefinition("civitai-ltx-2-3-synth-image-to-video");

		expect(t2v).toBeDefined();
		expect(t2v?.baseModel).toBe("ltx-2-3");
		expect(t2v?.requiresInputImage).toBe(false);
		expect(t2v?.parameterSchema.parse({})).toMatchObject({
			aspectRatio: "16:9",
			duration: 3,
			generateAudio: false,
			guidanceScale: 3,
			loraStrength: 1,
			resolution: "720p",
			steps: 30,
		});
		const durationField = t2v?.parameterFields.find(
			(field) => field.key === "duration"
		) as { enumValues?: readonly string[] } | undefined;
		expect(durationField?.enumValues).toEqual([
			"3",
			"6",
			"8",
			"10",
			"12",
			"14",
			"16",
			"18",
			"20",
		]);

		expect(i2v).toBeDefined();
		expect(i2v?.baseModel).toBe("ltx-2-3");
		expect(i2v?.requiresInputImage).toBe(true);
		expect(i2v?.parameterSchema.parse({})).toMatchObject({
			aspectRatio: "16:9",
			duration: 3,
			generateAudio: false,
			guidanceScale: 3,
			loraStrength: 1,
			resolution: "720p",
			steps: 30,
		});
	});

	it("resolves replicate-fooocus-sdxl with correct defaults", () => {
		const workflow = getWorkflowDefinition("replicate-fooocus-sdxl");
		expect(workflow).toBeDefined();
		expect(workflow?.baseModel).toBe("sdxl");
		expect(workflow?.parameterSchema.parse({})).toMatchObject({
			extraLoraWeight: 0.5,
			guidanceScale: 7,
			imageSize: "square_hd",
			loraWeight: 1,
			negativePrompt: "",
			numImages: 1,
			performanceSelection: "Speed",
			refinerSwitch: 0.5,
			sharpness: 2,
			styleSelections: "Fooocus V2,Fooocus Enhance,Fooocus Sharp",
			useDefaultLoras: false,
		});
	});

	it("resolves replicate-wan-2-2 fast workflows with correct defaults", () => {
		const textToVideo = getWorkflowDefinition(
			"replicate-wan-2-2-fast-text-to-video"
		);
		const imageToVideo = getWorkflowDefinition(
			"replicate-wan-2-2-fast-image-to-video"
		);

		expect(textToVideo).toBeDefined();
		expect(textToVideo?.baseModel).toBe("wan-2-2");
		expect(textToVideo?.parameterSchema.parse({})).toMatchObject({
			aspectRatio: "16:9",
			framesPerSecond: 16,
			goFast: true,
			interpolateOutput: true,
			loraScaleHigh: 1,
			loraScaleLow: 1,
			numFrames: 81,
			optimizePrompt: false,
			resolution: "480p",
			sampleShift: 12,
		});

		expect(imageToVideo).toBeDefined();
		expect(imageToVideo?.baseModel).toBe("wan-2-2");
		expect(imageToVideo?.parameterSchema.parse({})).toMatchObject({
			framesPerSecond: 16,
			goFast: true,
			interpolateOutput: false,
			loraScaleHigh: 1,
			loraScaleLow: 1,
			numFrames: 81,
			resolution: "480p",
			sampleShift: 12,
		});
	});

	it("marks loraUrl fields as optional in enriched parameter list", () => {
		const workflows = listWorkflows();
		const keys = [
			"runpod-fooocus-sdxl",
			"replicate-fooocus-sdxl",
			"replicate-flux-dev-lora",
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

	it("exposes paired high+low lora-url fields for Wan 2.2 workflows", () => {
		const workflows = listWorkflows();
		for (const key of [
			"replicate-wan-2-2-fast-text-to-video",
			"replicate-wan-2-2-fast-image-to-video",
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

	it("builds runpod-fooocus-sdxl payloads with optional LoRAs", () => {
		const workflow = getWorkflowDefinition("runpod-fooocus-sdxl");
		const buildInput = (extra: Record<string, unknown> = {}) =>
			workflow?.buildProviderInput({
				params: extra,
				prompt: "test",
			}) as Record<string, unknown>;

		expect(buildInput()).toMatchObject({
			__runpodWorkflow: "fooocus-sdxl",
			advanced_params: {
				overwrite_step: 30,
			},
			api_name: "txt2img",
			aspect_ratios_selection: "1024*1024",
			base_model_name: "juggernautXL_version6Rundiffusion.safetensors",
			enable_refiner: true,
			enable_safety_checker: false,
			guidance_scale: 4,
			image_number: 1,
			image_size: "square_hd",
			loras: [],
			loras_custom_urls: "",
			negative_prompt: "",
			num_images: 1,
			num_inference_steps: 30,
			output_format: "jpeg",
			prompt: "test",
			refiner_model_name: "sd_xl_refiner_1.0_0.9vae.safetensors",
			refiner_switch: 0.5,
			require_base64: true,
		});

		expect(
			buildInput({
				enableRefiner: "false",
				extraLoraUrl: "https://example.com/extra-sdxl.safetensors",
				extraLoraWeight: 0.25,
				loraUrl: "https://example.com/sdxl.safetensors",
				loraWeight: 0.8,
				outputFormat: "png",
				seed: 42,
			})
		).toMatchObject({
			__runpodWorkflow: "fooocus-sdxl",
			enable_refiner: false,
			image_seed: 42,
			loras: [
				{
					model_name: "sdxl.safetensors",
					url: "https://example.com/sdxl.safetensors",
					weight: 0.8,
				},
				{
					model_name: "extra-sdxl.safetensors",
					url: "https://example.com/extra-sdxl.safetensors",
					weight: 0.25,
				},
			],
			loras_custom_urls:
				"https://example.com/sdxl.safetensors,0.8;https://example.com/extra-sdxl.safetensors,0.25",
			output_format: "png",
			refiner_model_name: "None",
			seed: 42,
		});
	});

	it("builds runpod-ltx-2-3 pod payloads", () => {
		const i2vWorkflow = getWorkflowDefinition("runpod-ltx-2-3-image-to-video");
		const buildInput = (
			extra: Record<string, unknown> = {},
			inputImageUrl = "https://example.com/input.png"
		) =>
			i2vWorkflow?.buildProviderInput({
				inputImageUrl,
				params: extra,
				prompt: "A woman is doing gymnastics outdoors.",
			}) as Record<string, unknown>;

		expect(buildInput()).toMatchObject({
			__runpodWorkflow: "ltx-2-3-video",
			cfgScale: 1,
			fps: 24,
			height: 1280,
			inputImageUrl: "https://example.com/input.png",
			negativePrompt: expect.stringContaining("watermark"),
			numFrames: 241,
			prompt: "A woman is doing gymnastics outdoors.",
			steps: 8,
			width: 896,
		});
		expect(buildInput()).not.toHaveProperty("loraCivitaiModelId");

		expect(
			buildInput({
				durationSeconds: 15,
				fps: 24,
				height: 960,
				loraCivitaiModelId: 2_509_189,
				loraCivitaiVersionId: 2_820_451,
				loraScale: 0.85,
				seed: 900,
				width: 640,
			})
		).toMatchObject({
			height: 960,
			loraCivitaiModelId: 2_509_189,
			loraCivitaiVersionId: 2_820_451,
			loraScale: 0.85,
			numFrames: 361,
			seed: 900,
			width: 640,
		});

		expect(
			buildInput({
				numFrames: 121,
			})
		).toMatchObject({
			numFrames: 121,
		});
	});

	it("extracts only RunPod Pod video artifacts", () => {
		const workflow = getWorkflowDefinition("runpod-ltx-2-3-image-to-video");

		expect(
			workflow?.extractArtifactUrls({
				logUrl: "https://assets.example.com/pod.log",
				podId: "pod-123",
				runpodPodConsoleUrl: "https://runpod.io/console/pods/pod-123",
			})
		).toEqual([]);

		expect(
			workflow?.extractArtifactUrls({
				logUrl: "https://assets.example.com/pod.log",
				runpodPodConsoleUrl: "https://runpod.io/console/pods/pod-123",
				videoUrl: "https://assets.example.com/output.mp4",
			})
		).toEqual(["https://assets.example.com/output.mp4"]);
	});

	it("builds civitai-lustify-olt-sdxl payloads", () => {
		const workflow = getWorkflowDefinition("civitai-lustify-olt-sdxl");
		const buildInput = (extra: Record<string, unknown> = {}) =>
			workflow?.buildProviderInput({
				params: extra,
				prompt: "test",
			}) as Record<string, unknown>;

		expect(buildInput()).toMatchObject({
			__civitaiModel: "urn:air:sdxl:checkpoint:civitai:573152@1569593",
			$type: "textToImage",
			baseModel: "SDXL",
			model: "urn:air:sdxl:checkpoint:civitai:573152@1569593",
			params: {
				cfgScale: 3.5,
				clipSkip: 2,
				height: 1216,
				negativePrompt: "",
				prompt: "test",
				scheduler: "DPM2MKarras",
				steps: 30,
				width: 832,
			},
			quantity: 1,
		});

		expect(
			buildInput({
				cfgScale: 4,
				height: 1152,
				negativePrompt: "blur",
				numImages: 2,
				scheduler: "EulerA",
				seed: 42,
				steps: 28,
				width: 896,
			})
		).toMatchObject({
			params: {
				cfgScale: 4,
				height: 1152,
				negativePrompt: "blur",
				scheduler: "EulerA",
				seed: 42,
				steps: 28,
				width: 896,
			},
			quantity: 2,
		});
	});

	it("builds Civitai LTX-2.3 synth LoRA video payloads", () => {
		const t2v = getWorkflowDefinition("civitai-ltx-2-3-synth-text-to-video");
		const i2v = getWorkflowDefinition("civitai-ltx-2-3-synth-image-to-video");

		expect(
			t2v?.buildProviderInput({
				params: {
					aspectRatio: "9:16",
					duration: 18,
					generateAudio: "true",
					guidanceScale: 4,
					loraAir: "urn:air:ltxv23:lora:civitai:2487612@2800000",
					loraStrength: 0.8,
					resolution: "720p",
					seed: 42,
					steps: 32,
				},
				prompt: "test",
			})
		).toEqual({
			__civitaiEndpoint: "ltx2.3:synth-lora:createVideo",
			$type: "videoGen",
			input: {
				engine: "ltx2.3",
				operation: "createVideo",
				prompt: "test",
				width: 720,
				height: 1280,
				model: "22b-dev",
				guidanceScale: 4,
				steps: 32,
				duration: 18,
				generateAudio: true,
				loras: {
					"urn:air:ltxv23:lora:civitai:2487612@2800000": 0.8,
				},
				seed: 42,
			},
		});

		expect(
			i2v?.buildProviderInput({
				inputImageUrl: "https://storage.example.com/first.png",
				params: {
					endImageUrl: "https://storage.example.com/last.png",
				},
				prompt: "animate the scene",
			})
		).toEqual({
			__civitaiEndpoint: "ltx2.3:synth-lora:firstLastFrameToVideo",
			$type: "videoGen",
			input: {
				engine: "ltx2.3",
				operation: "firstLastFrameToVideo",
				prompt: "animate the scene",
				width: 1280,
				height: 720,
				model: "22b-dev",
				guidanceScale: 3,
				steps: 30,
				duration: 3,
				generateAudio: false,
				loras: {
					"urn:air:ltxv23:lora:civitai:2509189@2820451": 1,
				},
				firstFrame: "https://storage.example.com/first.png",
				lastFrame: "https://storage.example.com/last.png",
			},
		});
	});

	it("normalizes stale Civitai LTX-2.3 durations before provider submit", () => {
		const workflow = getWorkflowDefinition(
			"civitai-ltx-2-3-synth-text-to-video"
		);

		expect(
			workflow?.buildProviderInput({
				params: { duration: 5 },
				prompt: "test",
			})
		).toMatchObject({
			input: {
				duration: 3,
			},
		});
		expect(
			workflow?.buildProviderInput({
				params: { duration: 16 },
				prompt: "test",
			})
		).toMatchObject({
			input: {
				duration: 16,
			},
		});
	});

	it("builds replicate-fooocus-sdxl payloads with optional LoRAs", () => {
		const workflow = getWorkflowDefinition("replicate-fooocus-sdxl");
		const buildInput = (extra: Record<string, unknown> = {}) =>
			workflow?.buildProviderInput({
				params: extra,
				prompt: "test",
			}) as Record<string, unknown>;

		expect(buildInput()).toMatchObject({
			__replicateVersion:
				"bd7d45104209dc3e1e2765d364697f1393a92a210a0e47fdf943afbd2271a48c",
			aspect_ratios_selection: "1024*1024",
			guidance_scale: 7,
			image_number: 1,
			image_seed: -1,
			loras_custom_urls: "",
			negative_prompt: "",
			performance_selection: "Speed",
			prompt: "test",
			refiner_switch: 0.5,
			sharpness: 2,
			style_selections: "Fooocus V2,Fooocus Enhance,Fooocus Sharp",
			use_default_loras: false,
		});

		expect(
			buildInput({
				extraLoraUrl: "https://example.com/extra-sdxl.safetensors",
				extraLoraWeight: 0.25,
				guidanceScale: 4.5,
				imageSize: "portrait_4_3",
				loraUrl: "https://example.com/sdxl.safetensors",
				loraWeight: 0.8,
				negativePrompt: "blur",
				performanceSelection: "Quality",
				seed: 42,
				useDefaultLoras: "true",
			})
		).toMatchObject({
			aspect_ratios_selection: "896*1152",
			guidance_scale: 4.5,
			image_seed: 42,
			loras_custom_urls:
				"https://example.com/sdxl.safetensors,0.8;https://example.com/extra-sdxl.safetensors,0.25",
			negative_prompt: "blur",
			performance_selection: "Quality",
			use_default_loras: true,
		});
	});

	it("builds replicate-flux-dev-lora payloads with optional LoRAs", () => {
		const workflow = getWorkflowDefinition("replicate-flux-dev-lora");
		const buildInput = (extra: Record<string, unknown> = {}) =>
			workflow?.buildProviderInput({
				params: extra,
				prompt: "test",
			}) as Record<string, unknown>;

		expect(buildInput()).toMatchObject({
			__replicateVersion:
				"ae0d7d645446924cf1871e3ca8796e8318f72465d2b5af9323a835df93bf0917",
			aspect_ratio: "4:3",
			disable_safety_checker: true,
			go_fast: false,
			guidance: 3.5,
			megapixels: "1",
			num_inference_steps: 28,
			num_outputs: 1,
			output_format: "jpg",
			prompt: "test",
		});
		expect(buildInput()).not.toHaveProperty("lora_weights");
		expect(buildInput()).not.toHaveProperty("extra_lora");
		expect(buildInput()).not.toHaveProperty("seed");

		const withLora = buildInput({
			extraLoraScale: 0.4,
			extraLoraUrl: "https://example.com/extra-flux.safetensors",
			goFast: true,
			guidanceScale: 4,
			imageSize: "portrait_16_9",
			loraScale: 0.7,
			loraUrl: "https://example.com/flux.safetensors",
			seed: 42,
		});
		expect(withLora).toMatchObject({
			aspect_ratio: "9:16",
			extra_lora: "https://example.com/extra-flux.safetensors",
			extra_lora_scale: 0.4,
			go_fast: true,
			guidance: 4,
			lora_scale: 0.7,
			lora_weights: "https://example.com/flux.safetensors",
			seed: 42,
		});
	});

	it("maps imageSize → aspect_ratio for replicate-flux-dev-lora", () => {
		const workflow = getWorkflowDefinition("replicate-flux-dev-lora");
		const buildInput = (imageSize: string) =>
			workflow?.buildProviderInput({
				params: { imageSize },
				prompt: "test",
			}) as Record<string, unknown>;

		expect(buildInput("square_hd").aspect_ratio).toBe("1:1");
		expect(buildInput("square").aspect_ratio).toBe("1:1");
		expect(buildInput("landscape_4_3").aspect_ratio).toBe("4:3");
		expect(buildInput("landscape_16_9").aspect_ratio).toBe("16:9");
		expect(buildInput("portrait_4_3").aspect_ratio).toBe("3:4");
		expect(buildInput("portrait_16_9").aspect_ratio).toBe("9:16");
	});

	it("builds replicate-wan-2-2 fast text-to-video payloads", () => {
		const workflow = getWorkflowDefinition(
			"replicate-wan-2-2-fast-text-to-video"
		);

		expect(
			workflow?.buildProviderInput({
				params: {
					aspectRatio: "9:16",
					framesPerSecond: 24,
					goFast: "true",
					interpolateOutput: "false",
					loraScaleHigh: 0.8,
					loraScaleLow: 0.6,
					loraUrlHigh: "https://example.com/wan-high.safetensors",
					loraUrlLow: "https://example.com/wan-low.safetensors",
					numFrames: 121,
					optimizePrompt: "true",
					resolution: "720p",
					sampleShift: 10,
					seed: 42,
				},
				prompt: "a cinematic tracking shot across a rainy neon street",
			})
		).toMatchObject({
			__replicateVersion:
				"c483b1f7b892065bc58ebadb6381abf557f6b1f517d2ff0febb3fb635cf49b4d",
			aspect_ratio: "9:16",
			disable_safety_checker: true,
			frames_per_second: 24,
			go_fast: true,
			interpolate_output: false,
			lora_scale_transformer: 0.8,
			lora_scale_transformer_2: 0.6,
			lora_weights_transformer: "https://example.com/wan-high.safetensors",
			lora_weights_transformer_2: "https://example.com/wan-low.safetensors",
			num_frames: 121,
			optimize_prompt: true,
			prompt: "a cinematic tracking shot across a rainy neon street",
			resolution: "720p",
			sample_shift: 10,
			seed: 42,
		});
	});

	it("builds replicate-wan-2-2 fast image-to-video payloads", () => {
		const workflow = getWorkflowDefinition(
			"replicate-wan-2-2-fast-image-to-video"
		);

		expect(
			workflow?.buildProviderInput({
				inputImageUrl: "https://example.com/start.png",
				params: {
					endImageUrl: "https://example.com/end.png",
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
			go_fast: true,
			image: "https://example.com/start.png",
			interpolate_output: true,
			last_image: "https://example.com/end.png",
			num_frames: 81,
			prompt: "the subject turns toward camera as the light changes",
			resolution: "480p",
			sample_shift: 12,
		});
	});

	it("returns null for legacy or removed workflow keys", () => {
		expect(getWorkflowDefinition("ltx-2.3-i2v")).toBeNull();
		expect(getWorkflowDefinition("lustify-apex-avatar")).toBeNull();
		expect(getWorkflowDefinition("replicate-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("zib-dpo")).toBeNull();
		expect(getWorkflowDefinition("fal-flux-lora")).toBeNull();
		expect(getWorkflowDefinition("fal-flux-dev")).toBeNull();
		expect(getWorkflowDefinition("fal-zimage-turbo")).toBeNull();
		expect(getWorkflowDefinition("fal-wan-2-2-image-to-video")).toBeNull();
		expect(getWorkflowDefinition("fal-flux2-dev-edit")).toBeNull();
	});
});
