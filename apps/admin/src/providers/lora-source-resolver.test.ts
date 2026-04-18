import { describe, expect, it } from "bun:test";

import { createLoraSourceResolver } from "@/providers/lora-source-resolver";

describe("createLoraSourceResolver", () => {
	it("resolves Civitai model pages to version download URLs", async () => {
		const requests: { headers: Headers; url: string }[] = [];
		const resolver = createLoraSourceResolver({
			civitaiApiKey: "civitai-token",
			fetchImpl(input, init) {
				requests.push({
					headers: new Headers(init?.headers),
					url: input.toString(),
				});
				return Promise.resolve(
					new Response(
						JSON.stringify({
							id: 9,
							name: "Mystic LoRA",
							type: "LORA",
							description: "<p>Model notes</p>",
							modelVersions: [
								{
									id: 123,
									name: "v1",
									baseModel: "Flux.1 D",
									description: "<p>Version notes</p>",
									trainedWords: ["mystic"],
									files: [
										{
											downloadUrl:
												"https://civitai.com/api/download/models/123",
											name: "mystic.safetensors",
											metadata: { format: "SafeTensor" },
											primary: true,
											sizeKb: 2048,
										},
									],
									images: [
										{
											nsfw: false,
											url: "https://imagecache.civitai.com/preview.jpeg",
										},
									],
								},
							],
						}),
						{ status: 200 }
					)
				);
			},
		});

		const source = await resolver.resolve({
			baseModel: "other",
			sourceUrl: "https://civitai.red/models/9?modelVersionId=123",
		});

		expect(requests[0]?.url).toBe("https://civitai.red/api/v1/models/9");
		expect(requests[0]?.headers.get("authorization")).toBe(
			"Bearer civitai-token"
		);
		expect(source.provider).toBe("civitai");
		expect(source.baseModel).toBe("flux");
		expect(source.name).toBe("Mystic LoRA");
		expect(source.description).toContain("Trigger words: mystic.");
		expect(source.downloadUrl).toBe(
			"https://civitai.com/api/download/models/123"
		);
		expect(source.fileName).toBe("mystic.safetensors");
		expect(source.previewImageUrl).toBe(
			"https://imagecache.civitai.com/preview.jpeg"
		);
		expect(source.sizeBytes).toBe(2_097_152);
		expect(source.versionName).toBe("v1");
	});

	it("detects high/low pair across modelVersions for Wan 2.2", async () => {
		const resolver = createLoraSourceResolver({
			fetchImpl() {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							id: 42,
							name: "Cinematic Wan",
							type: "LORA",
							modelVersions: [
								{
									id: 100,
									name: "v1 High Noise",
									baseModel: "Wan Video 2.2 I2V-A14B",
									files: [
										{
											downloadUrl: "https://civitai.com/api/download/100",
											name: "cinematic-high.safetensors",
											primary: true,
											sizeKb: 4096,
										},
									],
								},
								{
									id: 101,
									name: "v1 Low Noise",
									baseModel: "Wan Video 2.2 I2V-A14B",
									files: [
										{
											downloadUrl: "https://civitai.com/api/download/101",
											name: "cinematic-low.safetensors",
											primary: true,
											sizeKb: 4096,
										},
									],
								},
							],
						}),
						{ status: 200 }
					)
				);
			},
		});

		const source = await resolver.resolve({
			baseModel: "wan-2-2",
			sourceUrl: "https://civitai.com/models/42?modelVersionId=100",
		});

		expect(source.baseModel).toBe("wan-2-2");
		expect(source.variant).toBe("high");
		expect(source.pairedFiles).toBeDefined();
		expect(source.pairedFiles).toHaveLength(2);
		const high = source.pairedFiles?.find((file) => file.variant === "high");
		const low = source.pairedFiles?.find((file) => file.variant === "low");
		expect(high?.downloadUrl).toBe("https://civitai.com/api/download/100");
		expect(low?.downloadUrl).toBe("https://civitai.com/api/download/101");
	});

	it("detects high/low pair from sibling files of the same Wan version", async () => {
		const resolver = createLoraSourceResolver({
			fetchImpl() {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							id: 43,
							name: "Wan Pair In One Version",
							type: "LORA",
							modelVersions: [
								{
									id: 200,
									name: "v1",
									baseModel: "Wan Video 2.2 I2V-A14B",
									files: [
										{
											downloadUrl: "https://civitai.com/api/download/200-h",
											name: "pair_HighNoise.safetensors",
											primary: true,
											sizeKb: 4096,
										},
										{
											downloadUrl: "https://civitai.com/api/download/200-l",
											name: "pair_LowNoise.safetensors",
											sizeKb: 4096,
										},
									],
								},
							],
						}),
						{ status: 200 }
					)
				);
			},
		});

		const source = await resolver.resolve({
			baseModel: "wan-2-2",
			sourceUrl: "https://civitai.com/models/43?modelVersionId=200",
		});

		expect(source.pairedFiles).toHaveLength(2);
		const high = source.pairedFiles?.find((file) => file.variant === "high");
		const low = source.pairedFiles?.find((file) => file.variant === "low");
		expect(high?.downloadUrl).toBe("https://civitai.com/api/download/200-h");
		expect(low?.downloadUrl).toBe("https://civitai.com/api/download/200-l");
	});

	it("does not produce pairedFiles for non dual-expert base models", async () => {
		const resolver = createLoraSourceResolver({
			fetchImpl() {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							id: 44,
							name: "Flux LoRA",
							type: "LORA",
							modelVersions: [
								{
									id: 300,
									name: "v1",
									baseModel: "Flux.1 D",
									files: [
										{
											downloadUrl: "https://civitai.com/api/download/300",
											name: "flux.safetensors",
											primary: true,
											sizeKb: 1024,
										},
									],
								},
							],
						}),
						{ status: 200 }
					)
				);
			},
		});

		const source = await resolver.resolve({
			baseModel: "flux",
			sourceUrl: "https://civitai.com/models/44?modelVersionId=300",
		});

		expect(source.pairedFiles).toBeUndefined();
		expect(source.variant).toBeUndefined();
	});

	it("builds Hugging Face resolve URLs from repo URLs and file paths", async () => {
		const source = await createLoraSourceResolver({
			huggingFaceToken: "hf-token",
		}).resolve({
			baseModel: "sdxl",
			sourceProvider: "huggingface",
			sourceUrl: "https://huggingface.co/org/model",
			sourceFilePath: "loras/style.safetensors",
			sourceRevision: "refs/pr/1",
		});

		expect(source.provider).toBe("huggingface");
		expect(source.downloadUrl).toBe(
			"https://huggingface.co/org/model/resolve/refs%2Fpr%2F1/loras/style.safetensors"
		);
		expect(new Headers(source.downloadHeaders).get("authorization")).toBe(
			"Bearer hf-token"
		);
		expect(source.name).toBe("style");
	});
});
