/**
 * Full fal.ai E2E test: generate reference images → train LoRA → generate with LoRA.
 *
 * Usage:
 *   FAL_KEY=xxx bun run apps/generator/src/testing/fal-full-e2e.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const FAL_BASE_URL = "https://queue.fal.run";
const OUTPUT_DIR = resolve(process.cwd(), ".artifacts/fal-full-e2e");
const POLL_INTERVAL_MS = 5000;
const GENERATION_TIMEOUT_MS = 3 * 60_000;
const TRAINING_TIMEOUT_MS = 30 * 60_000;

function log(stage: string, message: string, data?: unknown) {
	const ts = new Date().toISOString().slice(11, 19);
	const suffix = data ? ` ${JSON.stringify(data)}` : "";
	console.log(`[${ts}] [${stage}] ${message}${suffix}`);
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

async function writeJson(path: string, data: unknown) {
	await writeFile(path, JSON.stringify(data, null, 2));
}

interface FalSubmitResult {
	request_id: string;
	response_url?: string;
	status_url?: string;
}

function parseFalSubmitResult(body: Record<string, unknown>): FalSubmitResult {
	if (typeof body.request_id !== "string" || body.request_id.length === 0) {
		throw new Error(
			`fal submit response is missing request_id: ${JSON.stringify(body)}`
		);
	}

	return {
		request_id: body.request_id,
		response_url:
			typeof body.response_url === "string" ? body.response_url : undefined,
		status_url:
			typeof body.status_url === "string" ? body.status_url : undefined,
	};
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
	return parseFalSubmitResult(body);
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
				`fal status check failed (${statusResponse.status}): ${JSON.stringify(statusBody)}`
			);
		}

		const status = statusBody?.status as string;
		log("POLL", `[${model}] attempt ${attempt}: ${status}`);

		if (statusBody?.error) {
			throw new Error(`fal request failed: ${statusBody.error as string}`);
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

async function generateImages(
	apiKey: string,
	prompt: string,
	count: number,
	seed?: number
): Promise<string[]> {
	log("GEN", `Generating ${count} images...`);
	const submitResult = await falSubmit(apiKey, "fal-ai/flux/dev", {
		prompt,
		image_size: "square_hd",
		num_inference_steps: 28,
		guidance_scale: 3.5,
		num_images: count,
		enable_safety_checker: false,
		...(seed === undefined ? {} : { seed }),
	});

	log("GEN", `Submitted: ${submitResult.request_id}`);
	const result = await falPollUntilDone(
		apiKey,
		submitResult,
		"fal-ai/flux/dev",
		GENERATION_TIMEOUT_MS
	);

	const images = result.images as Array<{ url: string }> | undefined;
	if (!images?.length) {
		throw new Error("No images in generation result");
	}

	const urls = images.map((img) => img.url);
	log("GEN", `Generated ${urls.length} images`);
	return urls;
}

async function createTrainingZip(imageUrls: string[]): Promise<string> {
	log("ZIP", `Creating zip from ${imageUrls.length} images...`);

	const zipParts: Uint8Array[] = [];
	const encoder = new TextEncoder();

	const localFileHeaders: Array<{
		offset: number;
		name: Uint8Array;
		crc: number;
		compressedSize: number;
	}> = [];

	for (const [i, imageUrl] of imageUrls.entries()) {
		log("ZIP", `Downloading image ${i + 1}/${imageUrls.length}...`);
		const imgResponse = await fetch(imageUrl);
		const imgData = new Uint8Array(await imgResponse.arrayBuffer());

		const fileName = encoder.encode(`image_${i}.png`);
		const crc = crc32(imgData);
		const offset = zipParts.reduce((sum, part) => sum + part.length, 0);

		localFileHeaders.push({
			offset,
			name: fileName,
			crc,
			compressedSize: imgData.length,
		});

		const header = new Uint8Array(30 + fileName.length);
		const view = new DataView(header.buffer);
		view.setUint32(0, 0x04_03_4b_50, true); // local file header signature
		view.setUint16(4, 20, true); // version needed
		view.setUint16(6, 0, true); // flags
		view.setUint16(8, 0, true); // compression (store)
		view.setUint16(10, 0, true); // mod time
		view.setUint16(12, 0, true); // mod date
		view.setUint32(14, crc, true);
		view.setUint32(18, imgData.length, true); // compressed size
		view.setUint32(22, imgData.length, true); // uncompressed size
		view.setUint16(26, fileName.length, true);
		view.setUint16(28, 0, true); // extra field length
		header.set(fileName, 30);

		zipParts.push(header);
		zipParts.push(imgData);
	}

	const centralDirOffset = zipParts.reduce((sum, part) => sum + part.length, 0);
	let centralDirSize = 0;

	for (const entry of localFileHeaders) {
		const cdh = new Uint8Array(46 + entry.name.length);
		const view = new DataView(cdh.buffer);
		view.setUint32(0, 0x02_01_4b_50, true); // central dir signature
		view.setUint16(4, 20, true); // version made by
		view.setUint16(6, 20, true); // version needed
		view.setUint16(8, 0, true); // flags
		view.setUint16(10, 0, true); // compression
		view.setUint16(12, 0, true); // mod time
		view.setUint16(14, 0, true); // mod date
		view.setUint32(16, entry.crc, true);
		view.setUint32(20, entry.compressedSize, true);
		view.setUint32(24, entry.compressedSize, true);
		view.setUint16(28, entry.name.length, true);
		view.setUint16(30, 0, true); // extra field length
		view.setUint16(32, 0, true); // comment length
		view.setUint16(34, 0, true); // disk number
		view.setUint16(36, 0, true); // internal attrs
		view.setUint32(38, 0, true); // external attrs
		view.setUint32(42, entry.offset, true); // local header offset
		cdh.set(entry.name, 46);

		zipParts.push(cdh);
		centralDirSize += cdh.length;
	}

	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	eocdView.setUint32(0, 0x06_05_4b_50, true);
	eocdView.setUint16(4, 0, true);
	eocdView.setUint16(6, 0, true);
	eocdView.setUint16(8, localFileHeaders.length, true);
	eocdView.setUint16(10, localFileHeaders.length, true);
	eocdView.setUint32(12, centralDirSize, true);
	eocdView.setUint32(16, centralDirOffset, true);
	eocdView.setUint16(20, 0, true);
	zipParts.push(eocd);

	const totalSize = zipParts.reduce((sum, part) => sum + part.length, 0);
	const zipBuffer = new Uint8Array(totalSize);
	let offset = 0;
	for (const part of zipParts) {
		zipBuffer.set(part, offset);
		offset += part.length;
	}

	log(
		"ZIP",
		`Created zip (${(totalSize / 1024).toFixed(1)} KB), uploading to fal storage...`
	);

	const apiKey = requiredEnv("FAL_KEY");

	const initiateResponse = await fetch(
		"https://rest.alpha.fal.ai/storage/upload/initiate",
		{
			method: "POST",
			headers: {
				authorization: `Key ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				file_name: "training-images.zip",
				content_type: "application/zip",
			}),
		}
	);

	if (!initiateResponse.ok) {
		const errBody = await initiateResponse.text();
		throw new Error(
			`fal storage initiate failed (${initiateResponse.status}): ${errBody}`
		);
	}

	const { file_url, upload_url } = (await initiateResponse.json()) as {
		file_url: string;
		upload_url: string;
	};

	const uploadResponse = await fetch(upload_url, {
		method: "PUT",
		headers: { "content-type": "application/zip" },
		body: zipBuffer,
	});

	if (!uploadResponse.ok) {
		throw new Error(`fal storage upload PUT failed (${uploadResponse.status})`);
	}

	log("ZIP", `Uploaded to: ${file_url.slice(0, 80)}...`);
	return file_url;
}

function crc32(data: Uint8Array): number {
	let crc = 0xff_ff_ff_ff;
	for (const byte of data) {
		// biome-ignore lint/suspicious/noBitwiseOperators: CRC32
		crc ^= byte;
		for (let j = 0; j < 8; j++) {
			// biome-ignore lint/suspicious/noBitwiseOperators: CRC32
			crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
		}
	}
	// biome-ignore lint/suspicious/noBitwiseOperators: CRC32
	return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

async function trainLora(
	apiKey: string,
	zipUrl: string,
	triggerWord: string
): Promise<{ loraUrl: string; configUrl: string }> {
	log("TRAIN", `Starting LoRA training with trigger word: ${triggerWord}`);
	const submitResult = await falSubmit(
		apiKey,
		"fal-ai/flux-lora-fast-training",
		{
			images_data_url: zipUrl,
			trigger_word: triggerWord,
			steps: 1000,
			create_masks: true,
			is_style: false,
		}
	);

	log("TRAIN", `Submitted training: ${submitResult.request_id}`);
	const result = await falPollUntilDone(
		apiKey,
		submitResult,
		"fal-ai/flux-lora-fast-training",
		TRAINING_TIMEOUT_MS
	);

	const loraUrl = result.diffusers_lora_file as { url: string } | undefined;
	const configUrl = result.config_file as { url: string } | undefined;

	if (!loraUrl?.url) {
		log("TRAIN", "Full result:", result);
		throw new Error("Training completed but no diffusers_lora_file URL");
	}

	log("TRAIN", "Training complete!", {
		loraUrl: loraUrl.url.slice(0, 80),
	});

	return {
		loraUrl: loraUrl.url,
		configUrl: configUrl?.url ?? "",
	};
}

async function generateWithLora(
	apiKey: string,
	loraUrl: string,
	triggerWord: string,
	prompt: string
): Promise<string[]> {
	log("LORA-GEN", `Generating with LoRA: "${prompt.slice(0, 60)}..."`);
	const submitResult = await falSubmit(apiKey, "fal-ai/flux-lora", {
		prompt: `${prompt}, ${triggerWord}`,
		image_size: "landscape_4_3",
		num_inference_steps: 28,
		guidance_scale: 3.5,
		num_images: 2,
		loras: [{ path: loraUrl, scale: 1 }],
		enable_safety_checker: false,
	});

	log("LORA-GEN", `Submitted: ${submitResult.request_id}`);
	const result = await falPollUntilDone(
		apiKey,
		submitResult,
		"fal-ai/flux-lora",
		GENERATION_TIMEOUT_MS
	);

	const images = result.images as Array<{ url: string }> | undefined;
	if (!images?.length) {
		throw new Error("No images in LoRA generation result");
	}

	const urls = images.map((img) => img.url);
	log("LORA-GEN", `Generated ${urls.length} images with LoRA`);
	return urls;
}

async function main() {
	const apiKey = requiredEnv("FAL_KEY");

	console.log("=== fal.ai Full E2E Test ===");
	console.log("Pipeline: Generate refs → Train LoRA → Generate with LoRA\n");

	await mkdir(OUTPUT_DIR, { recursive: true });

	// Step 1: Generate 4 reference images of a girl
	log("STEP-1", "Generating reference images of a girl...");
	const refPrompt =
		"professional portrait photo of a young woman with shoulder-length auburn hair, green eyes, light freckles, soft natural lighting, neutral background, looking at camera, high detail, photorealistic";
	const refUrls = await generateImages(apiKey, refPrompt, 4, 42);
	await writeJson(`${OUTPUT_DIR}/1-ref-images.json`, {
		prompt: refPrompt,
		urls: refUrls,
	});
	for (const [i, url] of refUrls.entries()) {
		log("STEP-1", `  Reference ${i + 1}: ${url.slice(0, 80)}...`);
	}

	// Step 2: Package images into ZIP and upload
	log("STEP-2", "Packaging reference images for training...");
	const zipUrl = await createTrainingZip(refUrls);
	await writeJson(`${OUTPUT_DIR}/2-training-zip.json`, { zipUrl });

	// Step 3: Train LoRA
	log("STEP-3", "Training LoRA...");
	const triggerWord = "ohwx_woman";
	const { loraUrl, configUrl } = await trainLora(apiKey, zipUrl, triggerWord);
	await writeJson(`${OUTPUT_DIR}/3-lora-trained.json`, {
		loraUrl,
		configUrl,
		triggerWord,
	});

	// Step 4: Generate with LoRA in different settings
	log("STEP-4", "Generating images with trained LoRA...");

	const loraPrompts = [
		`portrait of ${triggerWord} in a modern coffee shop, warm lighting, casual outfit, smiling`,
		`${triggerWord} walking in a autumn park, golden hour, cinematic composition, natural look`,
	];

	const allLoraResults: string[] = [];
	for (const [i, prompt] of loraPrompts.entries()) {
		const urls = await generateWithLora(apiKey, loraUrl, triggerWord, prompt);
		allLoraResults.push(...urls);
		for (const url of urls) {
			log("STEP-4", `  LoRA result ${i + 1}: ${url.slice(0, 80)}...`);
		}
	}

	await writeJson(`${OUTPUT_DIR}/4-lora-results.json`, {
		prompts: loraPrompts,
		urls: allLoraResults,
	});

	// Summary
	console.log("\n=== fal.ai E2E Test Complete ===");
	console.log(`Reference images: ${refUrls.length}`);
	console.log(`LoRA URL: ${loraUrl}`);
	console.log(`LoRA generations: ${allLoraResults.length}`);
	console.log(`All artifacts saved to: ${OUTPUT_DIR}`);
	console.log("\nReference image URLs:");
	for (const url of refUrls) {
		console.log(`  ${url}`);
	}
	console.log("\nLoRA generation URLs:");
	for (const url of allLoraResults) {
		console.log(`  ${url}`);
	}
}

await main().catch((error: unknown) => {
	console.error(
		"\n=== E2E TEST FAILED ===",
		error instanceof Error ? error.message : error
	);
	process.exitCode = 1;
});
