/**
 * Re-run Step 5 (NSFW dual LoRA) + Step 4b (i2i workflow comparison).
 *
 * Usage:
 *   FAL_KEY=xxx bun run tools/e2e/zit-step5-rerun.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const FAL_BASE_URL = "https://queue.fal.run";
const OUTPUT_DIR = resolve(process.cwd(), ".artifacts/zit-full-e2e");
const POLL_INTERVAL_MS = 5000;
const GENERATION_TIMEOUT_MS = 3 * 60_000;

const NSFW_LORA_URL =
	"https://huggingface.co/samiyoya/loras/resolve/main/Mystic-XXX-ZIT-V4.safetensors";

function ts() {
	return new Date().toISOString().slice(11, 19);
}

function log(stage: string, message: string, data?: unknown) {
	const suffix = data ? ` ${JSON.stringify(data)}` : "";
	console.log(`[${ts()}] [${stage}] ${message}${suffix}`);
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

interface FalSubmitResult {
	request_id: string;
	response_url?: string;
	status_url?: string;
}

async function falSubmit(
	apiKey: string,
	model: string,
	input: Record<string, unknown>
): Promise<FalSubmitResult> {
	const response = await fetch(`${FAL_BASE_URL}/${model}`, {
		method: "POST",
		headers: {
			authorization: `Key ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(input),
	});
	const body = (await response.json()) as Record<string, unknown>;
	if (!response.ok) {
		throw new Error(
			`fal submit ${model} failed (${response.status}): ${JSON.stringify(body)}`
		);
	}
	if (typeof body.request_id !== "string") {
		throw new Error(`Missing request_id: ${JSON.stringify(body)}`);
	}
	return body as FalSubmitResult;
}

async function falPollUntilDone(
	apiKey: string,
	submit: FalSubmitResult,
	model: string,
	timeoutMs: number
): Promise<Record<string, unknown>> {
	const statusUrl =
		submit.status_url ??
		`${FAL_BASE_URL}/${model}/requests/${submit.request_id}/status`;
	const responseUrl =
		submit.response_url ??
		`${FAL_BASE_URL}/${model}/requests/${submit.request_id}`;

	const deadline = Date.now() + timeoutMs;
	let attempt = 0;

	while (Date.now() < deadline) {
		attempt += 1;
		await sleep(POLL_INTERVAL_MS);
		const statusResponse = await fetch(`${statusUrl}?logs=1`, {
			headers: { authorization: `Key ${apiKey}` },
		});
		const statusBody = (await statusResponse
			.json()
			.catch(() => null)) as Record<string, unknown> | null;
		if (!statusResponse.ok) {
			throw new Error(
				`fal status failed (${statusResponse.status}): ${JSON.stringify(statusBody)}`
			);
		}
		const status = statusBody?.status as string;
		log("POLL", `[${model}] attempt ${attempt}: ${status}`);
		if (statusBody?.error) {
			throw new Error(
				`fal request failed: ${JSON.stringify(statusBody.error)}`
			);
		}
		if (status === "COMPLETED") {
			const resultResponse = await fetch(responseUrl, {
				headers: { authorization: `Key ${apiKey}` },
			});
			return (await resultResponse.json()) as Record<string, unknown>;
		}
	}
	throw new Error(
		`Timed out waiting for ${model} request ${submit.request_id}`
	);
}

function extractImageUrls(result: Record<string, unknown>): string[] {
	const images = result.images as Array<{ url: string }> | undefined;
	if (!images?.length) {
		log("DEBUG", "Full result with no images:", result);
		throw new Error("No images in result");
	}
	return images.map((img) => img.url);
}

async function downloadAndSave(url: string, path: string) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Download failed ${url}: ${response.status}`);
	}
	const buffer = new Uint8Array(await response.arrayBuffer());
	await writeFile(path, buffer);
	return buffer.length;
}

async function main() {
	const apiKey = requiredEnv("FAL_KEY");

	const summaryFile = `${OUTPUT_DIR}/03-training-result.json`;
	const trainingData = JSON.parse(await readFile(summaryFile, "utf-8")) as {
		loraUrl: string;
		triggerWord: string;
	};
	const { loraUrl, triggerWord } = trainingData;

	const avatarFile = `${OUTPUT_DIR}/01-avatar-meta.json`;
	const avatarData = JSON.parse(await readFile(avatarFile, "utf-8")) as {
		url: string;
	};
	const avatarUrl = avatarData.url;

	console.log("╔══════════════════════════════════════════╗");
	console.log("║   ZIT Step 5 Re-run + I2I Comparison     ║");
	console.log("╚══════════════════════════════════════════╝");
	console.log(`  LoRA URL:      ${loraUrl.slice(0, 60)}...`);
	console.log(`  Trigger word:  ${triggerWord}`);
	console.log(`  Avatar URL:    ${avatarUrl.slice(0, 60)}...`);
	console.log(`  NSFW LoRA:     ${NSFW_LORA_URL.slice(0, 60)}...`);
	console.log("");

	// ════════════════════════════════════════════
	// PART A: NSFW dual LoRA via text-to-image
	// ════════════════════════════════════════════
	console.log("━━━ PART A: NSFW dual LoRA (t2i z-image/turbo/lora) ━━━");

	const nsfwDir = `${OUTPUT_DIR}/05-nsfw-lora`;
	await mkdir(nsfwDir, { recursive: true });
	const nsfwResultUrls: string[] = [];

	const nsfwPrompts = [
		`a photo of ${triggerWord}, artistic portrait, dramatic lighting, elegant pose, film noir style`,
		`a photo of ${triggerWord}, fashion editorial portrait, dark moody studio, high contrast, provocative`,
	];

	for (const [i, prompt] of nsfwPrompts.entries()) {
		log("NSFW-T2I", `Generation ${i + 1}/${nsfwPrompts.length}...`);

		const submit = await falSubmit(apiKey, "fal-ai/z-image/turbo/lora", {
			prompt,
			image_size: "portrait_4_3",
			num_inference_steps: 12,
			num_images: 2,
			enable_safety_checker: false,
			output_format: "png",
			loras: [
				{ path: loraUrl, weight: 1.0 },
				{ path: NSFW_LORA_URL, weight: 0.05 },
			],
		});

		const result = await falPollUntilDone(
			apiKey,
			submit,
			"fal-ai/z-image/turbo/lora",
			GENERATION_TIMEOUT_MS
		);

		const urls = extractImageUrls(result);
		nsfwResultUrls.push(...urls);

		for (const [j, url] of urls.entries()) {
			await downloadAndSave(url, `${nsfwDir}/t2i-${i + 1}-${j + 1}.png`);
		}
		log("NSFW-T2I", `  ✓ Generated ${urls.length} images`);
	}

	await writeFile(
		`${OUTPUT_DIR}/05-nsfw-results.json`,
		JSON.stringify(
			{
				prompts: nsfwPrompts,
				urls: nsfwResultUrls,
				faceLoraUrl: loraUrl,
				nsfwLoraUrl: NSFW_LORA_URL,
				triggerWord,
				model: "fal-ai/z-image/turbo/lora",
			},
			null,
			2
		)
	);
	console.log(`  ✓ NSFW t2i: ${nsfwResultUrls.length} images\n`);

	// ════════════════════════════════════════════
	// PART B: I2I workflow comparison (production-like)
	// ════════════════════════════════════════════
	console.log(
		"━━━ PART B: I2I workflow comparison (z-image/turbo/image-to-image/lora) ━━━"
	);

	const i2iDir = `${OUTPUT_DIR}/06-i2i-lora`;
	await mkdir(i2iDir, { recursive: true });
	const i2iResultUrls: string[] = [];

	const i2iPrompts = [
		`a photo of ${triggerWord}, professional headshot in modern office, warm natural light, confident smile`,
		`a photo of ${triggerWord}, outdoor portrait in autumn park, golden hour, casual outfit, cinematic composition`,
		`a photo of ${triggerWord}, close-up portrait, soft studio light, neutral background, sharp detail`,
	];

	for (const [i, prompt] of i2iPrompts.entries()) {
		log("I2I", `SFW i2i generation ${i + 1}/${i2iPrompts.length}...`);

		const submit = await falSubmit(
			apiKey,
			"fal-ai/z-image/turbo/image-to-image/lora",
			{
				prompt,
				image_url: avatarUrl,
				image_size: "portrait_4_3",
				num_inference_steps: 8,
				num_images: 2,
				enable_safety_checker: false,
				output_format: "png",
				strength: 0.95,
				loras: [{ path: loraUrl, weight: 1.0 }],
			}
		);

		const result = await falPollUntilDone(
			apiKey,
			submit,
			"fal-ai/z-image/turbo/image-to-image/lora",
			GENERATION_TIMEOUT_MS
		);

		const urls = extractImageUrls(result);
		i2iResultUrls.push(...urls);

		for (const [j, url] of urls.entries()) {
			await downloadAndSave(url, `${i2iDir}/${i + 1}-${j + 1}.png`);
		}
		log("I2I", `  ✓ Generated ${urls.length} i2i images`);
	}

	await writeFile(
		`${OUTPUT_DIR}/06-i2i-results.json`,
		JSON.stringify(
			{
				prompts: i2iPrompts,
				urls: i2iResultUrls,
				loraUrl,
				triggerWord,
				avatarUrl,
				model: "fal-ai/z-image/turbo/image-to-image/lora",
			},
			null,
			2
		)
	);
	console.log(`  ✓ I2I SFW: ${i2iResultUrls.length} images\n`);

	// ════════════════════════════════════════════
	// PART C: I2I + NSFW dual LoRA
	// ════════════════════════════════════════════
	console.log(
		"━━━ PART C: I2I + NSFW dual LoRA (z-image/turbo/image-to-image/lora) ━━━"
	);

	const i2iNsfwDir = `${OUTPUT_DIR}/07-i2i-nsfw-lora`;
	await mkdir(i2iNsfwDir, { recursive: true });
	const i2iNsfwResultUrls: string[] = [];

	const i2iNsfwPrompts = [
		`a photo of ${triggerWord}, artistic portrait, dramatic lighting, elegant pose`,
		`a photo of ${triggerWord}, fashion editorial, dark moody studio, high contrast`,
	];

	for (const [i, prompt] of i2iNsfwPrompts.entries()) {
		log("I2I-NSFW", `Generation ${i + 1}/${i2iNsfwPrompts.length}...`);

		const submit = await falSubmit(
			apiKey,
			"fal-ai/z-image/turbo/image-to-image/lora",
			{
				prompt,
				image_url: avatarUrl,
				image_size: "portrait_4_3",
				num_inference_steps: 8,
				num_images: 2,
				enable_safety_checker: false,
				output_format: "png",
				strength: 0.95,
				loras: [
					{ path: loraUrl, weight: 1.0 },
					{ path: NSFW_LORA_URL, weight: 0.05 },
				],
			}
		);

		const result = await falPollUntilDone(
			apiKey,
			submit,
			"fal-ai/z-image/turbo/image-to-image/lora",
			GENERATION_TIMEOUT_MS
		);

		const urls = extractImageUrls(result);
		i2iNsfwResultUrls.push(...urls);

		for (const [j, url] of urls.entries()) {
			await downloadAndSave(url, `${i2iNsfwDir}/${i + 1}-${j + 1}.png`);
		}
		log("I2I-NSFW", `  ✓ Generated ${urls.length} images`);
	}

	await writeFile(
		`${OUTPUT_DIR}/07-i2i-nsfw-results.json`,
		JSON.stringify(
			{
				prompts: i2iNsfwPrompts,
				urls: i2iNsfwResultUrls,
				faceLoraUrl: loraUrl,
				nsfwLoraUrl: NSFW_LORA_URL,
				avatarUrl,
				triggerWord,
				model: "fal-ai/z-image/turbo/image-to-image/lora",
			},
			null,
			2
		)
	);
	console.log(`  ✓ I2I NSFW: ${i2iNsfwResultUrls.length} images\n`);

	console.log("╔══════════════════════════════════════════╗");
	console.log("║         ALL PARTS COMPLETE                ║");
	console.log("╚══════════════════════════════════════════╝");
	console.log(`  NSFW t2i:    ${nsfwResultUrls.length} images`);
	console.log(`  SFW i2i:     ${i2iResultUrls.length} images`);
	console.log(`  NSFW i2i:    ${i2iNsfwResultUrls.length} images`);
}

await main().catch((error: unknown) => {
	console.error("FAILED:", error instanceof Error ? error.message : error);
	if (error instanceof Error && error.stack) {
		console.error(error.stack);
	}
	process.exitCode = 1;
});
