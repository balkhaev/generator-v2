import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const TRAINING_POLL_INTERVAL_MS = 30_000;
const TRAINING_MAX_POLL_DURATION_MS = 4 * 60 * 60 * 1000;
const DEFAULT_TRAINING_STEPS = 500;
const REFERENCE_COUNT = Number.parseInt(
	process.env.PERSON_LORA_REFERENCE_COUNT ?? "19",
	10
);
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const REF_EXT_PATTERN = /\.(png|jpe?g|webp)/i;

const REFERENCE_VARIANT_SUFFIXES = [
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

export const startCerebriumLoraTrainingSchema = z.object({
	description: z.string().trim().optional(),
	outputName: z.string().trim().min(1).optional(),
	personId: z.string().trim().min(1),
	personName: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	referencePhotoUrl: z.url(),
	referencePrompt: z.string().trim().min(1).optional(),
	trainingRunId: z.string().trim().min(1),
	triggerWord: z.string().trim().min(1).optional(),
});

type StartInput = z.infer<typeof startCerebriumLoraTrainingSchema>;

type TrainingEventStatus =
	| "queued"
	| "generating"
	| "training"
	| "publishing"
	| "ready"
	| "failed";

function sanitizeSegment(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/giu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
}

function buildReferencePrompt(input: {
	description?: string;
	personName: string;
	referencePrompt?: string;
}) {
	return (
		input.referencePrompt?.trim() ||
		(input.description?.trim().length
			? `portrait photo of ${input.personName}, ${input.description}`
			: `portrait photo of ${input.personName}, preserve the same identity and facial features`)
	);
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError =
				error instanceof Error ? error : new Error("Unknown operation failure");
			if (attempt < DEFAULT_RETRY_ATTEMPTS) {
				await sleep(DEFAULT_RETRY_DELAY_MS);
			}
		}
	}
	throw lastError ?? new Error("Operation failed");
}

async function cerebriumRequest<T>(
	apiKey: string,
	url: string,
	body: Record<string, unknown>,
	timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T & { run_id: string }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			method: "POST",
			signal: controller.signal,
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
		const responseBody = (await response.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (!response.ok || responseBody === null) {
			const detail =
				responseBody && typeof responseBody.detail === "string"
					? responseBody.detail
					: JSON.stringify(responseBody);
			throw new Error(
				`Cerebrium request failed [${response.status}]: ${detail}`
			);
		}
		const result = (responseBody.result ?? responseBody) as T & {
			run_id: string;
		};
		if (!result.run_id && responseBody.run_id) {
			(result as Record<string, unknown>).run_id =
				responseBody.run_id as string;
		}
		return result;
	} finally {
		clearTimeout(timeout);
	}
}

async function pollTrainingStatus(
	apiKey: string,
	statusUrl: string,
	jobId: string,
	intervalMs: number,
	maxDurationMs: number,
	logger: Pick<Console, "info" | "error">
): Promise<{ lora_url: string; steps: number; trigger_word: string }> {
	const deadline = Date.now() + maxDurationMs;

	while (Date.now() < deadline) {
		await sleep(intervalMs);
		try {
			const result = await cerebriumRequest<{
				status: string;
				lora_url?: string;
				steps?: number;
				trigger_word?: string;
				error?: string;
			}>(apiKey, statusUrl, { job_id: jobId }, REQUEST_TIMEOUT_MS);

			if (result.status === "completed" && result.lora_url) {
				return {
					lora_url: result.lora_url,
					steps: result.steps ?? 0,
					trigger_word: result.trigger_word ?? "",
				};
			}

			if (result.status === "failed") {
				throw new Error(
					`Cerebrium training failed: ${result.error ?? "unknown error"}`
				);
			}

			logger.info("cerebrium-lora.poll-status", {
				jobId,
				status: result.status,
				elapsed: Date.now() + maxDurationMs - deadline,
			});
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("Cerebrium training failed")
			) {
				throw error;
			}
			logger.error("cerebrium-lora.poll-error", {
				jobId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	throw new Error(
		`Cerebrium training polling timed out after ${maxDurationMs / 60_000} minutes`
	);
}

async function _cerebriumAsyncRequest(
	apiKey: string,
	url: string,
	body: Record<string, unknown>
): Promise<{ run_id: string }> {
	const asyncUrl = `${url}?async=true`;
	const response = await fetch(asyncUrl, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const responseBody = (await response.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;
	if (!response.ok || responseBody === null) {
		const detail =
			responseBody && typeof responseBody.detail === "string"
				? responseBody.detail
				: JSON.stringify(responseBody);
		throw new Error(
			`Cerebrium async request failed [${response.status}]: ${detail}`
		);
	}
	return { run_id: (responseBody.run_id as string) ?? "" };
}

function downloadAsBuffer(url: string): Promise<Uint8Array> {
	return retry(async () => {
		if (url.startsWith("data:")) {
			const base64Part = url.split(",")[1];
			if (!base64Part) {
				throw new Error("Invalid data URL");
			}
			const binary = atob(base64Part);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			return bytes;
		}
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download: ${response.status}`);
		}
		return new Uint8Array(await response.arrayBuffer());
	});
}

async function toDataUrl(url: string): Promise<string> {
	if (url.startsWith("data:")) {
		return url;
	}
	const buf = await downloadAsBuffer(url);
	const b64 = Buffer.from(buf).toString("base64");
	const ext = url.match(REF_EXT_PATTERN)?.[1]?.toLowerCase() ?? "jpeg";
	const mime = ext === "png" ? "image/png" : "image/jpeg";
	return `data:${mime};base64,${b64}`;
}

function crc32(data: Uint8Array): number {
	let crc = 0xff_ff_ff_ff;
	for (const byte of data) {
		// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
			crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
		}
	}
	// biome-ignore lint/suspicious/noBitwiseOperators: CRC32 algorithm
	return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function buildZipFromBuffers(
	files: Array<{ name: string; data: Uint8Array }>
): Uint8Array {
	const entries: Uint8Array[] = [];
	const centralDir: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const nameBytes = new TextEncoder().encode(file.name);
		const checksum = crc32(file.data);

		const localHeader = new Uint8Array(30 + nameBytes.length);
		const view = new DataView(localHeader.buffer);
		view.setUint32(0, 0x04_03_4b_50, true);
		view.setUint16(4, 20, true);
		view.setUint16(8, 0, true);
		view.setUint32(14, checksum, true);
		view.setUint32(18, file.data.length, true);
		view.setUint32(22, file.data.length, true);
		view.setUint16(26, nameBytes.length, true);
		localHeader.set(nameBytes, 30);

		const cdEntry = new Uint8Array(46 + nameBytes.length);
		const cdView = new DataView(cdEntry.buffer);
		cdView.setUint32(0, 0x02_01_4b_50, true);
		cdView.setUint16(4, 20, true);
		cdView.setUint16(6, 20, true);
		cdView.setUint16(12, 0, true);
		cdView.setUint32(16, checksum, true);
		cdView.setUint32(20, file.data.length, true);
		cdView.setUint32(24, file.data.length, true);
		cdView.setUint16(28, nameBytes.length, true);
		cdView.setUint32(42, offset, true);
		cdEntry.set(nameBytes, 46);

		entries.push(localHeader, file.data);
		centralDir.push(cdEntry);
		offset += localHeader.length + file.data.length;
	}

	const cdOffset = offset;
	let cdSize = 0;
	for (const entry of centralDir) {
		cdSize += entry.length;
	}

	const endRecord = new Uint8Array(22);
	const endView = new DataView(endRecord.buffer);
	endView.setUint32(0, 0x06_05_4b_50, true);
	endView.setUint16(8, files.length, true);
	endView.setUint16(10, files.length, true);
	endView.setUint32(12, cdSize, true);
	endView.setUint32(16, cdOffset, true);

	const totalSize = offset + cdSize + 22;
	const result = new Uint8Array(totalSize);
	let pos = 0;
	for (const part of [...entries, ...centralDir, endRecord]) {
		result.set(part, pos);
		pos += part.length;
	}
	return result;
}

async function uploadZipToS3(
	zipData: Uint8Array,
	filename: string,
	s3Config: {
		bucket: string;
		endpoint: string;
		accessKey: string;
		secretKey: string;
		region: string;
		publicUrl: string;
	}
): Promise<string> {
	const key = `datasets/${filename}`;
	const dateStamp = new Date().toISOString().replace(/[:-]/g, "").slice(0, 15);
	const url = `${s3Config.endpoint}/${s3Config.bucket}/${key}`;

	const { createHmac, createHash } = await import("node:crypto");
	const shortDate = dateStamp.slice(0, 8);
	const scope = `${shortDate}/${s3Config.region}/s3/aws4_request`;
	const hash = (data: string) =>
		createHash("sha256").update(data).digest("hex");
	const hmac = (key: Buffer | string, data: string) =>
		createHmac("sha256", key).update(data).digest();
	const payloadHash = hash(
		Buffer.from(
			zipData.buffer,
			zipData.byteOffset,
			zipData.byteLength
		).toString("binary")
	);

	const headers: Record<string, string> = {
		host: new URL(s3Config.endpoint).host,
		"content-type": "application/zip",
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": `${dateStamp}Z`,
	};

	const signedHeaders = Object.keys(headers).sort().join(";");
	const canonicalHeaders = Object.keys(headers)
		.sort()
		.map((k) => `${k}:${headers[k]}\n`)
		.join("");
	const canonicalRequest = [
		"PUT",
		`/${s3Config.bucket}/${key}`,
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");

	const stringToSign = [
		"AWS4-HMAC-SHA256",
		`${dateStamp}Z`,
		scope,
		hash(canonicalRequest),
	].join("\n");

	const signingKey = hmac(
		hmac(
			hmac(hmac(`AWS4${s3Config.secretKey}`, shortDate), s3Config.region),
			"s3"
		),
		"aws4_request"
	);
	const signature = createHmac("sha256", signingKey)
		.update(stringToSign)
		.digest("hex");

	headers.authorization = `AWS4-HMAC-SHA256 Credential=${s3Config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

	const response = await fetch(url, {
		method: "PUT",
		headers,
		body: zipData,
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`S3 upload failed: ${response.status} ${detail.slice(0, 200)}`
		);
	}
	return `${s3Config.publicUrl}/${key}`;
}

const FAL_STORAGE_INITIATE =
	"https://rest.alpha.fal.ai/storage/upload/initiate";
const UPLOAD_TIMEOUT_MS = 600_000;

async function uploadZipToFalStorage(
	apiKey: string,
	zipData: Uint8Array,
	filename: string
): Promise<string> {
	const maxAttempts = 5;
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const initResponse = await fetch(FAL_STORAGE_INITIATE, {
				method: "POST",
				headers: {
					authorization: `Key ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					file_name: filename,
					content_type: "application/zip",
				}),
			});
			if (!initResponse.ok) {
				const detail = await initResponse.text().catch(() => "");
				throw new Error(
					`fal storage initiate failed: ${initResponse.status} ${detail}`
				);
			}
			const { file_url, upload_url } = (await initResponse.json()) as {
				file_url: string;
				upload_url: string;
			};

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
			try {
				const uploadResponse = await fetch(upload_url, {
					method: "PUT",
					headers: { "content-type": "application/zip" },
					body: zipData,
					signal: controller.signal,
				});
				if (!uploadResponse.ok) {
					const detail = await uploadResponse.text().catch(() => "");
					throw new Error(
						`fal storage upload failed: ${uploadResponse.status} ${detail}`
					);
				}
			} finally {
				clearTimeout(timeout);
			}
			return file_url;
		} catch (error) {
			lastError =
				error instanceof Error ? error : new Error("Unknown upload failure");
			console.error(
				`fal-storage-upload attempt ${attempt}/${maxAttempts} failed:`,
				lastError.message
			);
			if (attempt < maxAttempts) {
				await new Promise((r) => setTimeout(r, 2000 * attempt));
			}
		}
	}
	throw lastError ?? new Error("fal storage upload exhausted retries");
}

export class CerebriumLoraTrainingRunner {
	private readonly apiKey: string;
	private readonly projectId: string;
	private readonly region: string;
	private readonly personsApiBaseUrl: string;
	private readonly trainingControlToken: string;
	private readonly falKey?: string;
	private readonly s3Config?: {
		bucket: string;
		endpoint: string;
		accessKey: string;
		secretKey: string;
		region: string;
		publicUrl: string;
	};
	private readonly logger: Pick<Console, "info" | "error">;

	constructor(options: {
		apiKey: string;
		projectId: string;
		region?: string;
		personsApiBaseUrl: string;
		trainingControlToken: string;
		falKey?: string;
		s3Config?: {
			bucket: string;
			endpoint: string;
			accessKey: string;
			secretKey: string;
			region: string;
			publicUrl: string;
		};
		logger?: Pick<Console, "info" | "error">;
	}) {
		this.apiKey = options.apiKey;
		this.projectId = options.projectId;
		this.region = options.region ?? "aws.us-east-1";
		this.personsApiBaseUrl = options.personsApiBaseUrl;
		this.trainingControlToken = options.trainingControlToken;
		this.falKey = options.falKey;
		this.s3Config = options.s3Config;
		this.logger = options.logger ?? console;
	}

	private get baseUrl() {
		return `https://api.${this.region}.cerebrium.ai/v4/${this.projectId}`;
	}

	private async sendTrainingEvent(input: {
		personId: string;
		event: {
			assetReleaseId?: string | null;
			datasetUrl?: string | null;
			errorSummary?: string | null;
			loraUrl?: string | null;
			referenceImageUrls?: string[];
			status: TrainingEventStatus;
			trainingRunId?: string | null;
			triggerWord?: string | null;
		};
	}) {
		await retry(async () => {
			await fetch(`${this.personsApiBaseUrl}/api/internal/lora-trainings`, {
				body: JSON.stringify({
					context: { personId: input.personId },
					event: input.event,
				}),
				headers: {
					authorization: `Bearer ${this.trainingControlToken}`,
					"content-type": "application/json",
				},
				method: "POST",
			});
		});
	}

	private async generateReferenceImage(
		prompt: string,
		sourceImage: string
	): Promise<string> {
		const result = await cerebriumRequest<{
			images: Array<{ url: string }>;
		}>(
			this.apiKey,
			`${this.baseUrl}/flux-inference/img2img`,
			{
				model_id:
					"GuangyuanSD/Z-Image-Distilled:RedZFUN-v6-ZIB-Distilled-AGILE-8steps-BF16-ComfyUI.safetensors",
				prompt,
				image: sourceImage,
				strength: 0.55,
				num_inference_steps: 8,
				guidance_scale: 1.0,
				num_images: 1,
			},
			REQUEST_TIMEOUT_MS
		);
		const url = result.images?.[0]?.url;
		if (!url) {
			throw new Error("Cerebrium img2img returned no images");
		}
		return url;
	}

	async run(input: StartInput) {
		const parsed = startCerebriumLoraTrainingSchema.parse(input);
		const triggerWord =
			parsed.triggerWord ??
			sanitizeSegment(parsed.personSlug).replace(/-/gu, "_");

		try {
			const outputName =
				parsed.outputName ??
				`${sanitizeSegment(parsed.personSlug)}-cerebrium-lora-${Date.now()}`;
			const baseReferencePrompt = buildReferencePrompt({
				description: parsed.description,
				personName: parsed.personName,
				referencePrompt: parsed.referencePrompt,
			});

			this.logger.info("cerebrium-lora.generating-references", {
				personId: parsed.personId,
				count: REFERENCE_COUNT,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					status: "generating",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			const sourceImageDataUrl = await toDataUrl(parsed.referencePhotoUrl);

			const referenceImageUrls: string[] = [];
			for (const suffix of REFERENCE_VARIANT_SUFFIXES.slice(
				0,
				REFERENCE_COUNT
			)) {
				const prompt = `${baseReferencePrompt}, ${suffix}`;
				const url = await this.generateReferenceImage(
					prompt,
					sourceImageDataUrl
				);
				referenceImageUrls.push(url);
				this.logger.info("cerebrium-lora.reference-generated", {
					personId: parsed.personId,
					index: referenceImageUrls.length,
					total: REFERENCE_COUNT,
				});
			}

			this.logger.info("cerebrium-lora.downloading-dataset", {
				personId: parsed.personId,
				imageCount: referenceImageUrls.length + 1,
			});

			const refPhoto = await downloadAsBuffer(parsed.referencePhotoUrl);
			const refExt =
				parsed.referencePhotoUrl.match(REF_EXT_PATTERN)?.[0] ?? ".jpg";
			const generatedImages = await Promise.all(
				referenceImageUrls.map(async (url, index) => ({
					name: `${String(index + 1).padStart(3, "0")}.jpg`,
					data: await downloadAsBuffer(url),
				}))
			);

			const captionContent = `a photo of ${triggerWord}, portrait`;
			const zipFiles: Array<{ name: string; data: Uint8Array }> = [
				{ name: `000${refExt}`, data: refPhoto },
				{
					name: "000.txt",
					data: new TextEncoder().encode(captionContent),
				},
			];

			for (const img of generatedImages) {
				zipFiles.push(img);
				zipFiles.push({
					name: img.name.replace(".jpg", ".txt"),
					data: new TextEncoder().encode(captionContent),
				});
			}

			const zipData = buildZipFromBuffers(zipFiles);

			if (!(this.s3Config || this.falKey)) {
				throw new Error(
					"S3 config or FAL_KEY is required for Cerebrium LoRA training (dataset upload)"
				);
			}

			this.logger.info("cerebrium-lora.uploading-dataset", {
				personId: parsed.personId,
				zipSizeBytes: zipData.length,
				method: this.s3Config ? "s3" : "fal-storage",
			});

			let datasetUrl: string;
			if (this.s3Config) {
				datasetUrl = await uploadZipToS3(
					zipData,
					`${outputName}-dataset.zip`,
					this.s3Config
				);
			} else {
				const falKey = this.falKey;
				if (!falKey) {
					throw new Error(
						"FAL_KEY is required for dataset upload when S3 is not configured"
					);
				}
				datasetUrl = await uploadZipToFalStorage(
					falKey,
					zipData,
					`${outputName}-dataset.zip`
				);
			}

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					datasetUrl,
					referenceImageUrls: [parsed.referencePhotoUrl, ...referenceImageUrls],
					status: "training",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});

			const trainingSteps = Number(
				process.env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS
			);

			this.logger.info("cerebrium-lora.preparing-storage", {
				personId: parsed.personId,
			});

			await cerebriumRequest(
				this.apiKey,
				`${this.baseUrl}/flux-inference/prepare_for_training`,
				{},
				REQUEST_TIMEOUT_MS
			);

			const trainingJobId = `${sanitizeSegment(parsed.personSlug)}-${Date.now()}`;

			this.logger.info("cerebrium-lora.starting-training", {
				personId: parsed.personId,
				steps: trainingSteps,
				jobId: trainingJobId,
			});

			const trainingStart = Date.now();

			await cerebriumRequest(
				this.apiKey,
				`${this.baseUrl}/lora-training/train`,
				{
					model_id: "Tongyi-MAI/Z-Image",
					dataset_url: datasetUrl,
					job_id: trainingJobId,
					steps: trainingSteps,
					trigger_word: triggerWord,
					learning_rate: 1e-4,
					default_caption: captionContent,
					resolution: 512,
					lora_rank: 16,
					guidance_scale: 5.0,
					train_batch_size: 1,
					gradient_accumulation_steps: 1,
				},
				30 * 60 * 1000
			);

			this.logger.info("cerebrium-lora.training-submitted", {
				personId: parsed.personId,
				jobId: trainingJobId,
			});

			const trainingResult = await pollTrainingStatus(
				this.apiKey,
				`${this.baseUrl}/lora-training/get_training_status`,
				trainingJobId,
				TRAINING_POLL_INTERVAL_MS,
				TRAINING_MAX_POLL_DURATION_MS,
				this.logger
			);

			this.logger.info("cerebrium-lora.training-completed", {
				personId: parsed.personId,
				durationMs: Date.now() - trainingStart,
			});

			const loraUrl = trainingResult.lora_url;
			if (!loraUrl) {
				throw new Error(
					"Cerebrium LoRA training completed but no weights URL was returned"
				);
			}

			this.logger.info("cerebrium-lora.training-completed", {
				personId: parsed.personId,
				loraUrl,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					datasetUrl,
					loraUrl,
					referenceImageUrls: [parsed.referencePhotoUrl, ...referenceImageUrls],
					status: "ready",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error
					? error.message
					: "Cerebrium LoRA training failed";
			this.logger.error("cerebrium-lora.failed", {
				personId: parsed.personId,
				error: errorSummary,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					errorSummary,
					status: "failed",
					trainingRunId: parsed.trainingRunId,
					triggerWord,
				},
			});
			throw error;
		}
	}
}
