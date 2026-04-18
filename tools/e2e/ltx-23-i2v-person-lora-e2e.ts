/**
 * Live E2E: reference portraits → train Flux LoRA → LTX 2.3 22B image-to-video /lora
 * using a person photo + trained LoRA (matches studio "person + LoRA" path).
 *
 * Requires: FAL_KEY
 *
 * Full pipeline (default):
 *   FAL_KEY=xxx bun run tools/e2e/ltx-23-i2v-person-lora-e2e.ts
 *
 * Skip training (you already have public URLs):
 *   FAL_KEY=xxx IMAGE_URL=https://... LORA_URL=https://... \\
 *     bun run tools/e2e/ltx-23-i2v-person-lora-e2e.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const FAL_BASE_URL = "https://queue.fal.run";
const LTX_MODEL = "fal-ai/ltx-2.3-22b/image-to-video/lora";
const OUTPUT_DIR = resolve(
	process.cwd(),
	".artifacts/ltx-23-i2v-person-lora-e2e"
);
const POLL_INTERVAL_MS = 5000;
const FLUX_GEN_TIMEOUT_MS = 4 * 60_000;
const TRAIN_TIMEOUT_MS = 35 * 60_000;
const LTX_TIMEOUT_MS = 25 * 60_000;

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
	modelForFallbackUrl: string,
	timeoutMs: number
): Promise<Record<string, unknown>> {
	const statusUrl =
		submit.status_url ??
		`${FAL_BASE_URL}/${modelForFallbackUrl}/requests/${submit.request_id}/status`;
	const responseUrl =
		submit.response_url ??
		`${FAL_BASE_URL}/${modelForFallbackUrl}/requests/${submit.request_id}`;

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
		log("POLL", `[${modelForFallbackUrl}] attempt ${attempt}: ${status}`);

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
		`Timed out waiting for ${modelForFallbackUrl} request ${submit.request_id}`
	);
}

async function generatePortraitRefs(
	apiKey: string,
	prompt: string,
	count: number,
	seed?: number
): Promise<string[]> {
	log("GEN", `Flux dev: generating ${count} reference images...`);
	const submitResult = await falSubmit(apiKey, "fal-ai/flux/dev", {
		prompt,
		image_size: "square_hd",
		num_inference_steps: 28,
		guidance_scale: 3.5,
		num_images: count,
		enable_safety_checker: false,
		...(seed === undefined ? {} : { seed }),
	});

	const result = await falPollUntilDone(
		apiKey,
		submitResult,
		"fal-ai/flux/dev",
		FLUX_GEN_TIMEOUT_MS
	);

	const images = result.images as Array<{ url: string }> | undefined;
	if (!images?.length) {
		throw new Error("No images in Flux generation result");
	}
	const urls = images.map((img) => img.url);
	log("GEN", `Got ${urls.length} image URLs`);
	return urls;
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

async function createTrainingZip(imageUrls: string[]): Promise<string> {
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
		view.setUint32(0, 0x04_03_4b_50, true);
		view.setUint16(4, 20, true);
		view.setUint16(6, 0, true);
		view.setUint16(8, 0, true);
		view.setUint16(10, 0, true);
		view.setUint16(12, 0, true);
		view.setUint32(14, crc, true);
		view.setUint32(18, imgData.length, true);
		view.setUint32(22, imgData.length, true);
		view.setUint16(26, fileName.length, true);
		view.setUint16(28, 0, true);
		header.set(fileName, 30);

		zipParts.push(header);
		zipParts.push(imgData);
	}

	const centralDirOffset = zipParts.reduce((sum, part) => sum + part.length, 0);
	let centralDirSize = 0;

	for (const entry of localFileHeaders) {
		const cdh = new Uint8Array(46 + entry.name.length);
		const view = new DataView(cdh.buffer);
		view.setUint32(0, 0x02_01_4b_50, true);
		view.setUint16(4, 20, true);
		view.setUint16(6, 20, true);
		view.setUint16(8, 0, true);
		view.setUint16(10, 0, true);
		view.setUint16(12, 0, true);
		view.setUint16(14, 0, true);
		view.setUint32(16, entry.crc, true);
		view.setUint32(20, entry.compressedSize, true);
		view.setUint32(24, entry.compressedSize, true);
		view.setUint16(28, entry.name.length, true);
		view.setUint16(30, 0, true);
		view.setUint16(32, 0, true);
		view.setUint16(34, 0, true);
		view.setUint16(36, 0, true);
		view.setUint32(38, 0, true);
		view.setUint32(42, entry.offset, true);
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

	log("ZIP", `Uploaded zip: ${file_url.slice(0, 80)}...`);
	return file_url;
}

async function trainFluxLora(
	apiKey: string,
	zipUrl: string,
	triggerWord: string
): Promise<string> {
	log("TRAIN", `fal-ai/flux-lora-fast-training, trigger: ${triggerWord}`);
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

	const result = await falPollUntilDone(
		apiKey,
		submitResult,
		"fal-ai/flux-lora-fast-training",
		TRAIN_TIMEOUT_MS
	);

	const loraUrl = result.diffusers_lora_file as { url: string } | undefined;
	if (!loraUrl?.url) {
		log("TRAIN", "Unexpected result", result);
		throw new Error("Training completed but no diffusers_lora_file URL");
	}
	log("TRAIN", "LoRA ready", { url: loraUrl.url.slice(0, 96) });
	return loraUrl.url;
}

async function runLtx23I2vWithLora(
	apiKey: string,
	imageUrl: string,
	loraUrl: string,
	prompt: string
): Promise<string> {
	log("LTX", "Submitting LTX 2.3 22B image-to-video /lora...");
	const input: Record<string, unknown> = {
		prompt,
		image_url: imageUrl,
		num_frames: 49,
		video_size: "auto",
		fps: 24,
		num_inference_steps: 30,
		video_cfg_scale: 3,
		generate_audio: true,
		use_multiscale: true,
		enable_prompt_expansion: false,
		enable_safety_checker: false,
		loras: [{ path: loraUrl, scale: 0.85 }],
	};

	const submit = await falSubmit(apiKey, LTX_MODEL, input);
	log("LTX", `Queued: ${submit.request_id}`);
	const result = await falPollUntilDone(
		apiKey,
		submit,
		LTX_MODEL,
		LTX_TIMEOUT_MS
	);
	const video = result.video as { url?: string } | undefined;
	if (!video?.url) {
		log("LTX", "Unexpected result keys", Object.keys(result));
		throw new Error("LTX result missing video.url");
	}
	return video.url;
}

async function main() {
	const apiKey = requiredEnv("FAL_KEY");
	const imageUrlEnv = process.env.IMAGE_URL?.trim();
	const loraUrlEnv = process.env.LORA_URL?.trim();

	await mkdir(OUTPUT_DIR, { recursive: true });

	console.log("=== LTX 2.3 I2V + person LoRA — live E2E ===\n");

	let imageUrl: string;
	let loraUrl: string;
	const triggerWord =
		process.env.TRIGGER_WORD?.trim() ??
		(imageUrlEnv && loraUrlEnv ? "" : "ohwx_person");

	if (imageUrlEnv && loraUrlEnv) {
		log("MODE", "IMAGE_URL + LORA_URL — skipping Flux train");
		imageUrl = imageUrlEnv;
		loraUrl = loraUrlEnv;
	} else {
		const refPrompt =
			"professional portrait photo of a young woman with shoulder-length auburn hair, soft natural lighting, neutral grey studio background, looking at camera, photorealistic, high detail";
		log("STEP-1", "Flux reference portraits (safety checker off)...");
		const refUrls = await generatePortraitRefs(apiKey, refPrompt, 4, 42);
		await writeJson(`${OUTPUT_DIR}/1-flux-refs.json`, {
			prompt: refPrompt,
			urls: refUrls,
		});
		imageUrl = refUrls[0] ?? "";
		if (!imageUrl) {
			throw new Error("No reference image URL");
		}

		log("STEP-2", "ZIP + upload for training...");
		const zipUrl = await createTrainingZip(refUrls);
		await writeJson(`${OUTPUT_DIR}/2-zip.json`, { zipUrl });

		log("STEP-3", "Train Flux LoRA (same path as fal-full-e2e)...");
		loraUrl = await trainFluxLora(apiKey, zipUrl, triggerWord);
		await writeJson(`${OUTPUT_DIR}/3-lora.json`, { loraUrl, triggerWord });
	}

	const videoPrompt =
		triggerWord.length > 0
			? `Slow subtle camera push-in, natural blink and micro-expressions, cinematic lighting, ${triggerWord} subject continuity`
			: "Slow subtle camera push-in, natural blink and micro-expressions, cinematic lighting, photorealistic motion";
	log(
		"STEP-4",
		"LTX 2.3 image-to-video + LoRA (enable_safety_checker: false)..."
	);
	const videoUrl = await runLtx23I2vWithLora(
		apiKey,
		imageUrl,
		loraUrl,
		videoPrompt
	);
	await writeJson(`${OUTPUT_DIR}/4-ltx-video.json`, {
		imageUrl,
		loraUrl,
		prompt: videoPrompt,
		videoUrl,
	});

	console.log("\n=== OK ===");
	console.log(`Video: ${videoUrl}`);
	console.log(`Artifacts: ${OUTPUT_DIR}`);
}

await main().catch((error: unknown) => {
	console.error(
		"\n=== FAILED ===",
		error instanceof Error ? error.message : error
	);
	process.exitCode = 1;
});
