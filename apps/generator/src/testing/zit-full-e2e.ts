/**
 * Full ZIT (Z-Image Turbo) E2E test:
 *   1. Create character avatar with z-image/turbo
 *   2. Create dataset variations with flux-2/edit
 *   3. Train LoRA with z-image-trainer
 *   4. Generate SFW images with face LoRA via z-image/turbo/lora
 *   5. Generate images with face LoRA + external NSFW LoRA via z-image/turbo/lora
 *
 * Usage:
 *   FAL_KEY=xxx bun run apps/generator/src/testing/zit-full-e2e.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const FAL_BASE_URL = "https://queue.fal.run";
const OUTPUT_DIR = resolve(process.cwd(), ".artifacts/zit-full-e2e");
const POLL_INTERVAL_MS = 5000;
const GENERATION_TIMEOUT_MS = 3 * 60_000;
const TRAINING_TIMEOUT_MS = 90 * 60_000;
const DATASET_TIMEOUT_MS = 10 * 60_000;

const CIVITAI_NSFW_LORA_URL =
	"https://civitai.red/models/2206377/zit-mystic-xxx";

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

async function writeJson(path: string, data: unknown) {
	await writeFile(path, JSON.stringify(data, null, 2));
}

async function downloadAndSave(url: string, path: string) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status}`);
	}
	const buffer = new Uint8Array(await response.arrayBuffer());
	await writeFile(path, buffer);
	return buffer.length;
}

interface FalSubmitResult {
	request_id: string;
	response_url?: string;
	status_url?: string;
}

function parseFalSubmitResult(body: Record<string, unknown>): FalSubmitResult {
	if (typeof body.request_id !== "string" || body.request_id.length === 0) {
		throw new Error(
			`fal submit response missing request_id: ${JSON.stringify(body)}`
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

function extractImageUrls(result: Record<string, unknown>): string[] {
	const images = result.images as Array<{ url: string }> | undefined;
	if (!images?.length) {
		throw new Error("No images in result");
	}
	return images.map((img) => img.url);
}

const civitaiModelIdPattern = /models\/(\d+)/;

async function resolveLoraDownloadUrl(civitaiUrl: string): Promise<string> {
	log("RESOLVE", `Resolving LoRA download URL from: ${civitaiUrl}`);

	const modelMatch = civitaiUrl.match(civitaiModelIdPattern);
	if (!modelMatch) {
		throw new Error(`Cannot parse model ID from URL: ${civitaiUrl}`);
	}
	const modelId = modelMatch[1];

	const apiUrl = `https://civitai.com/api/v1/models/${modelId}`;
	log("RESOLVE", `Fetching model info from: ${apiUrl}`);
	const response = await fetch(apiUrl);

	if (!response.ok) {
		log(
			"RESOLVE",
			`CivitAI API returned ${response.status}, using direct download fallback`
		);
		return `https://civitai.com/api/download/models/${modelId}`;
	}

	const model = (await response.json()) as {
		modelVersions?: Array<{
			id: number;
			files?: Array<{ downloadUrl?: string; name?: string }>;
		}>;
	};

	const latestVersion = model.modelVersions?.[0];
	const safetensorsFile = latestVersion?.files?.find((f) =>
		f.name?.endsWith(".safetensors")
	);
	const downloadUrl =
		safetensorsFile?.downloadUrl ??
		latestVersion?.files?.[0]?.downloadUrl ??
		`https://civitai.com/api/download/models/${latestVersion?.id ?? modelId}`;

	log("RESOLVE", `Resolved download URL: ${downloadUrl.slice(0, 80)}...`);
	return downloadUrl;
}

async function main() {
	const apiKey = requiredEnv("FAL_KEY");
	const startTime = Date.now();

	console.log("╔══════════════════════════════════════════╗");
	console.log("║   ZIT (Z-Image Turbo) Full E2E Test      ║");
	console.log("╚══════════════════════════════════════════╝");
	console.log("");

	await mkdir(OUTPUT_DIR, { recursive: true });

	// ════════════════════════════════════════════
	// STEP 1: Create character avatar with z-image/turbo
	// ════════════════════════════════════════════
	console.log("\n━━━ STEP 1: Create character avatar (z-image/turbo) ━━━");

	const characterPrompt =
		"professional portrait photo of a young woman with long dark brown hair, blue eyes, fair skin, soft natural lighting, neutral grey background, looking directly at camera, sharp detail, photorealistic, 4k quality";

	log("STEP-1", "Generating character avatar...");
	const avatarSubmit = await falSubmit(apiKey, "fal-ai/z-image/turbo", {
		prompt: characterPrompt,
		image_size: "portrait_4_3",
		num_inference_steps: 8,
		num_images: 1,
		enable_safety_checker: false,
		output_format: "png",
		seed: 42,
	});

	log("STEP-1", `Submitted: ${avatarSubmit.request_id}`);
	const avatarResult = await falPollUntilDone(
		apiKey,
		avatarSubmit,
		"fal-ai/z-image/turbo",
		GENERATION_TIMEOUT_MS
	);

	const avatarUrls = extractImageUrls(avatarResult);
	const avatarUrl = avatarUrls[0];
	log("STEP-1", `Avatar generated: ${avatarUrl.slice(0, 80)}...`);

	const avatarSize = await downloadAndSave(
		avatarUrl,
		`${OUTPUT_DIR}/01-avatar.png`
	);
	await writeJson(`${OUTPUT_DIR}/01-avatar-meta.json`, {
		prompt: characterPrompt,
		url: avatarUrl,
		sizeBytes: avatarSize,
		seed: 42,
		model: "fal-ai/z-image/turbo",
	});
	console.log(`  ✓ Avatar saved (${(avatarSize / 1024).toFixed(0)} KB)`);

	// ════════════════════════════════════════════
	// STEP 2: Create dataset with flux-2/edit
	// ════════════════════════════════════════════
	console.log("\n━━━ STEP 2: Create dataset variations (flux-2/edit) ━━━");

	const variantSuffixes = [
		"same subject, front-facing editorial portrait, soft daylight, neutral backdrop",
		"same subject, three-quarter portrait, warm studio key light, realistic skin detail",
		"same subject, close-up beauty portrait, diffused window light, shallow depth of field",
		"same subject, medium shot portrait, clean white cyc wall, fashion studio lighting",
		"same subject, outdoor portrait, golden hour sun, subtle breeze in hair",
		"same subject, street portrait, overcast daylight, muted urban background",
		"same subject, cinematic portrait, rim light, dark neutral background",
		"same subject, smiling portrait, bright commercial lighting, clean framing",
		"same subject, moody portrait, single overhead spotlight, deep shadow on one side",
		"same subject, high-key portrait, pure white background, soft even lighting",
		"same subject, natural portrait, dappled sunlight through foliage, relaxed pose",
		"same subject, editorial close-up, dramatic side light, catchlight in eyes",
		"same subject, glamour portrait, backlit hair glow, soft focus edges",
		"same subject, casual portrait, coffee shop interior, ambient warm tones",
		"same subject, professional headshot, solid grey background, centered framing",
		"same subject, artistic portrait, blue hour twilight, soft cool tones",
		"same subject, lifestyle portrait, airy minimalist interior, natural window light",
		"same subject, dramatic portrait, chiaroscuro lighting, strong jaw shadow",
		"same subject, soft portrait, overcast flat lighting, pastel toned background",
	] as const;
	const datasetCount = variantSuffixes.length;
	const basePrompt =
		"portrait photo of the subject, preserve the same identity and facial features";
	const datasetImageUrls: string[] = [avatarUrl];
	const datasetDir = `${OUTPUT_DIR}/02-dataset`;
	await mkdir(datasetDir, { recursive: true });

	log("STEP-2", `Generating ${datasetCount} dataset variations...`);

	for (const [i, suffix] of variantSuffixes.entries()) {
		const prompt = `${basePrompt}, ${suffix}`;
		log("STEP-2", `Variation ${i + 1}/${datasetCount}...`);

		const submit = await falSubmit(apiKey, "fal-ai/flux-2/edit", {
			prompt,
			image_urls: [avatarUrl],
			guidance_scale: 2.5,
			num_inference_steps: 28,
			image_size: "portrait_4_3",
			num_images: 1,
			enable_safety_checker: false,
			output_format: "jpeg",
		});

		const result = await falPollUntilDone(
			apiKey,
			submit,
			"fal-ai/flux-2/edit",
			DATASET_TIMEOUT_MS
		);

		const urls = extractImageUrls(result);
		datasetImageUrls.push(urls[0]);

		await downloadAndSave(
			urls[0],
			`${datasetDir}/${String(i + 1).padStart(2, "0")}.jpg`
		);
		log("STEP-2", `  ✓ Variation ${i + 1}: ${urls[0].slice(0, 60)}...`);
	}

	await writeJson(`${OUTPUT_DIR}/02-dataset-meta.json`, {
		totalImages: datasetImageUrls.length,
		urls: datasetImageUrls,
		model: "fal-ai/flux-2/edit",
	});
	console.log(
		`  ✓ Dataset complete: ${datasetImageUrls.length} images (1 original + ${datasetCount} variations)`
	);

	// ════════════════════════════════════════════
	// STEP 3: Upload ZIP and train LoRA
	// ════════════════════════════════════════════
	console.log("\n━━━ STEP 3: Train LoRA (z-image-trainer) ━━━");

	const triggerWord = "zit_test_subject";
	const captionContent = `a photo of ${triggerWord}, portrait`;

	log("STEP-3", "Building training ZIP...");
	const zipData = await buildTrainingZip(datasetImageUrls, captionContent);
	log("STEP-3", `ZIP size: ${(zipData.length / 1024).toFixed(0)} KB`);
	await writeFile(`${OUTPUT_DIR}/03-training-data.zip`, zipData);

	log("STEP-3", "Uploading ZIP to fal storage...");
	const zipUrl = await uploadToFalStorage(apiKey, zipData);
	log("STEP-3", `Uploaded: ${zipUrl.slice(0, 80)}...`);

	const trainingSteps = 1000;
	log("STEP-3", `Starting LoRA training (${trainingSteps} steps)...`);

	const trainingSubmit = await falSubmit(apiKey, "fal-ai/z-image-trainer", {
		image_data_url: zipUrl,
		steps: trainingSteps,
		default_caption: captionContent,
		learning_rate: 0.0001,
		training_type: "content",
	});

	log("STEP-3", `Training submitted: ${trainingSubmit.request_id}`);
	const trainingStartMs = Date.now();

	const trainingResult = await falPollUntilDone(
		apiKey,
		trainingSubmit,
		"fal-ai/z-image-trainer",
		TRAINING_TIMEOUT_MS
	);

	const trainingElapsedMs = Date.now() - trainingStartMs;
	const diffusersLoraFile = trainingResult.diffusers_lora_file as
		| { url?: string }
		| undefined;
	const loraUrl = diffusersLoraFile?.url;

	if (!loraUrl) {
		log("STEP-3", "Full training result:", trainingResult);
		throw new Error("Training completed but no diffusers_lora_file URL");
	}

	log("STEP-3", `LoRA trained in ${(trainingElapsedMs / 1000).toFixed(0)}s`);
	log("STEP-3", `LoRA URL: ${loraUrl.slice(0, 80)}...`);

	await writeJson(`${OUTPUT_DIR}/03-training-result.json`, {
		loraUrl,
		triggerWord,
		trainingSteps,
		trainingElapsedMs,
		model: "fal-ai/z-image-trainer",
		requestId: trainingSubmit.request_id,
	});
	console.log(
		`  ✓ LoRA trained (${(trainingElapsedMs / 60_000).toFixed(1)} min)`
	);

	// ════════════════════════════════════════════
	// STEP 4: Generate SFW images with face LoRA
	// ════════════════════════════════════════════
	console.log(
		"\n━━━ STEP 4: Generate SFW with face LoRA (z-image/turbo/lora) ━━━"
	);

	const sfwPrompts = [
		`a photo of ${triggerWord}, professional headshot in modern office, warm natural light, confident smile`,
		`a photo of ${triggerWord}, outdoor portrait in autumn park, golden hour, casual outfit, cinematic composition`,
		`a photo of ${triggerWord}, close-up portrait, soft studio light, neutral background, sharp detail`,
	];

	const sfwResultUrls: string[] = [];
	const sfwDir = `${OUTPUT_DIR}/04-sfw-lora`;
	await mkdir(sfwDir, { recursive: true });

	for (const [i, prompt] of sfwPrompts.entries()) {
		log("STEP-4", `SFW generation ${i + 1}/${sfwPrompts.length}...`);

		const submit = await falSubmit(apiKey, "fal-ai/z-image/turbo/lora", {
			prompt,
			image_size: "portrait_4_3",
			num_inference_steps: 12,
			num_images: 2,
			enable_safety_checker: false,
			output_format: "png",
			loras: [{ path: loraUrl, weight: 1.0 }],
		});

		const result = await falPollUntilDone(
			apiKey,
			submit,
			"fal-ai/z-image/turbo/lora",
			GENERATION_TIMEOUT_MS
		);

		const urls = extractImageUrls(result);
		sfwResultUrls.push(...urls);

		for (const [j, url] of urls.entries()) {
			await downloadAndSave(url, `${sfwDir}/${i + 1}-${j + 1}.png`);
		}

		log("STEP-4", `  ✓ Generated ${urls.length} SFW images`);
	}

	await writeJson(`${OUTPUT_DIR}/04-sfw-results.json`, {
		prompts: sfwPrompts,
		urls: sfwResultUrls,
		loraUrl,
		triggerWord,
		model: "fal-ai/z-image/turbo/lora",
	});
	console.log(`  ✓ SFW LoRA generation: ${sfwResultUrls.length} images`);

	// ════════════════════════════════════════════
	// STEP 5: Generate with face LoRA + NSFW LoRA
	// ════════════════════════════════════════════
	console.log(
		"\n━━━ STEP 5: Generate with face LoRA + NSFW LoRA (z-image/turbo/lora) ━━━"
	);

	let nsfwLoraUrl: string;
	try {
		nsfwLoraUrl = await resolveLoraDownloadUrl(CIVITAI_NSFW_LORA_URL);
	} catch {
		log(
			"STEP-5",
			"Could not resolve CivitAI LoRA URL. Skipping NSFW LoRA test."
		);
		nsfwLoraUrl = "";
	}

	const nsfwResultUrls: string[] = [];
	const nsfwDir = `${OUTPUT_DIR}/05-nsfw-lora`;
	await mkdir(nsfwDir, { recursive: true });

	if (nsfwLoraUrl) {
		const nsfwPrompts = [
			`a photo of ${triggerWord}, artistic portrait, dramatic lighting, elegant pose, film noir style`,
			`a photo of ${triggerWord}, fashion editorial portrait, dark moody studio, high contrast`,
		];

		for (const [i, prompt] of nsfwPrompts.entries()) {
			log("STEP-5", `NSFW LoRA generation ${i + 1}/${nsfwPrompts.length}...`);

			const submit = await falSubmit(apiKey, "fal-ai/z-image/turbo/lora", {
				prompt,
				image_size: "portrait_4_3",
				num_inference_steps: 12,
				num_images: 2,
				enable_safety_checker: false,
				output_format: "png",
				loras: [
					{ path: loraUrl, weight: 1.0 },
					{ path: nsfwLoraUrl, weight: 0.05 },
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
				await downloadAndSave(url, `${nsfwDir}/${i + 1}-${j + 1}.png`);
			}

			log("STEP-5", `  ✓ Generated ${urls.length} images with dual LoRA`);
		}

		await writeJson(`${OUTPUT_DIR}/05-nsfw-results.json`, {
			prompts: nsfwPrompts,
			urls: nsfwResultUrls,
			faceLoraUrl: loraUrl,
			nsfwLoraUrl,
			triggerWord,
			model: "fal-ai/z-image/turbo/lora",
		});
		console.log(`  ✓ Dual LoRA generation: ${nsfwResultUrls.length} images`);
	} else {
		console.log("  ⚠ NSFW LoRA step skipped (URL resolution failed)");
	}

	// ════════════════════════════════════════════
	// SUMMARY
	// ════════════════════════════════════════════
	const totalElapsedMs = Date.now() - startTime;
	console.log("\n╔══════════════════════════════════════════╗");
	console.log("║           E2E TEST COMPLETE               ║");
	console.log("╚══════════════════════════════════════════╝");
	console.log(
		`  Total time:         ${(totalElapsedMs / 60_000).toFixed(1)} min`
	);
	console.log(`  Avatar URL:         ${avatarUrl}`);
	console.log(`  Dataset images:     ${datasetImageUrls.length}`);
	console.log(`  LoRA URL:           ${loraUrl}`);
	console.log(`  Trigger word:       ${triggerWord}`);
	console.log(`  SFW generations:    ${sfwResultUrls.length}`);
	console.log(`  NSFW generations:   ${nsfwResultUrls.length}`);
	console.log(`  Artifacts dir:      ${OUTPUT_DIR}`);
	console.log("");

	await writeJson(`${OUTPUT_DIR}/00-summary.json`, {
		totalElapsedMs,
		avatarUrl,
		datasetImageCount: datasetImageUrls.length,
		loraUrl,
		triggerWord,
		sfwGenerationCount: sfwResultUrls.length,
		nsfwGenerationCount: nsfwResultUrls.length,
		sfwUrls: sfwResultUrls,
		nsfwUrls: nsfwResultUrls,
		allImageUrls: {
			avatar: avatarUrl,
			dataset: datasetImageUrls,
			sfw: sfwResultUrls,
			nsfw: nsfwResultUrls,
		},
	});

	console.log("Image URLs for visual inspection:");
	console.log("\n  [Avatar]");
	console.log(`    ${avatarUrl}`);
	console.log("\n  [SFW LoRA generations]");
	for (const url of sfwResultUrls) {
		console.log(`    ${url}`);
	}
	if (nsfwResultUrls.length > 0) {
		console.log("\n  [NSFW dual LoRA generations]");
		for (const url of nsfwResultUrls) {
			console.log(`    ${url}`);
		}
	}
}

async function buildTrainingZip(
	imageUrls: string[],
	caption: string
): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const zipParts: Uint8Array[] = [];
	const localFileHeaders: Array<{
		offset: number;
		name: Uint8Array;
		crc: number;
		compressedSize: number;
	}> = [];

	for (const [i, imageUrl] of imageUrls.entries()) {
		log("ZIP", `Downloading ${i + 1}/${imageUrls.length}...`);
		const imgResponse = await fetch(imageUrl);
		if (!imgResponse.ok) {
			throw new Error(`Failed to download image: ${imgResponse.status}`);
		}
		const imgData = new Uint8Array(await imgResponse.arrayBuffer());

		const contentType = imgResponse.headers.get("content-type") ?? "";
		let ext = ".jpg";
		if (contentType.includes("png")) {
			ext = ".png";
		} else if (contentType.includes("webp")) {
			ext = ".webp";
		}

		const baseName = String(i).padStart(3, "0");
		const imageFileName = encoder.encode(`${baseName}${ext}`);
		const captionFileName = encoder.encode(`${baseName}.txt`);
		const captionData = encoder.encode(caption);

		addZipEntry(zipParts, localFileHeaders, imageFileName, imgData);
		addZipEntry(zipParts, localFileHeaders, captionFileName, captionData);
	}

	return finalizeZip(zipParts, localFileHeaders);
}

function addZipEntry(
	parts: Uint8Array[],
	headers: Array<{
		offset: number;
		name: Uint8Array;
		crc: number;
		compressedSize: number;
	}>,
	name: Uint8Array,
	data: Uint8Array
) {
	const crc = crc32(data);
	const offset = parts.reduce((sum, part) => sum + part.length, 0);

	headers.push({ offset, name, crc, compressedSize: data.length });

	const header = new Uint8Array(30 + name.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x04_03_4b_50, true);
	view.setUint16(4, 20, true);
	view.setUint16(8, 0, true);
	view.setUint32(14, crc, true);
	view.setUint32(18, data.length, true);
	view.setUint32(22, data.length, true);
	view.setUint16(26, name.length, true);
	header.set(name, 30);

	parts.push(header);
	parts.push(data);
}

function finalizeZip(
	parts: Uint8Array[],
	headers: Array<{
		offset: number;
		name: Uint8Array;
		crc: number;
		compressedSize: number;
	}>
): Uint8Array {
	const centralDirOffset = parts.reduce((sum, part) => sum + part.length, 0);
	let centralDirSize = 0;

	for (const entry of headers) {
		const cdh = new Uint8Array(46 + entry.name.length);
		const view = new DataView(cdh.buffer);
		view.setUint32(0, 0x02_01_4b_50, true);
		view.setUint16(4, 20, true);
		view.setUint16(6, 20, true);
		view.setUint32(16, entry.crc, true);
		view.setUint32(20, entry.compressedSize, true);
		view.setUint32(24, entry.compressedSize, true);
		view.setUint16(28, entry.name.length, true);
		view.setUint32(42, entry.offset, true);
		cdh.set(entry.name, 46);
		parts.push(cdh);
		centralDirSize += cdh.length;
	}

	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	eocdView.setUint32(0, 0x06_05_4b_50, true);
	eocdView.setUint16(8, headers.length, true);
	eocdView.setUint16(10, headers.length, true);
	eocdView.setUint32(12, centralDirSize, true);
	eocdView.setUint32(16, centralDirOffset, true);
	parts.push(eocd);

	const totalSize = parts.reduce((sum, part) => sum + part.length, 0);
	const zipBuffer = new Uint8Array(totalSize);
	let offset = 0;
	for (const part of parts) {
		zipBuffer.set(part, offset);
		offset += part.length;
	}
	return zipBuffer;
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

async function uploadToFalStorage(
	apiKey: string,
	zipData: Uint8Array
): Promise<string> {
	const initiateResponse = await fetch(
		"https://rest.alpha.fal.ai/storage/upload/initiate",
		{
			method: "POST",
			headers: {
				authorization: `Key ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				file_name: "zit-training-images.zip",
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
		body: zipData,
	});

	if (!uploadResponse.ok) {
		throw new Error(`fal storage upload PUT failed (${uploadResponse.status})`);
	}

	return file_url;
}

await main().catch((error: unknown) => {
	console.error("\n╔══════════════════════════════════════════╗");
	console.error("║         E2E TEST FAILED                   ║");
	console.error("╚══════════════════════════════════════════╝");
	console.error(error instanceof Error ? error.message : error);
	if (error instanceof Error && error.stack) {
		console.error(error.stack);
	}
	process.exitCode = 1;
});
