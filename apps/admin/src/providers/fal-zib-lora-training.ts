import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_STORAGE_INITIATE =
	"https://rest.alpha.fal.ai/storage/upload/initiate";
const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TRAINING_STEPS = 1000;
const DEFAULT_TRAINING_POLL_MS = 30_000;
const DEFAULT_TRAINING_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_DATASET_POLL_MS = 5000;
const DEFAULT_DATASET_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const REFERENCE_COUNT = 19;
const referenceImageUrlExtensionPattern = /\.(png|jpe?g|webp)/i;

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

export const startFalZibLoraTrainingSchema = z.object({
	description: z.string().trim().optional(),
	outputName: z.string().trim().min(1).optional(),
	personId: z.string().trim().min(1),
	personName: z.string().trim().min(1),
	personSlug: z.string().trim().min(1),
	referencePhotoUrl: z.url(),
	referencePrompt: z.string().trim().min(1).optional(),
	triggerWord: z.string().trim().min(1).optional(),
});

type StartInput = z.infer<typeof startFalZibLoraTrainingSchema>;

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

async function falRequest<T>(
	apiKey: string,
	url: string,
	init?: RequestInit
): Promise<T & Record<string, unknown>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			...init,
			signal: controller.signal,
			headers: {
				authorization: `Key ${apiKey}`,
				"content-type": "application/json",
				...(init?.headers as Record<string, string> | undefined),
			},
		});
		const body = (await response.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (!response.ok || body === null) {
			const detail = body && typeof body.detail === "string" ? body.detail : "";
			throw new Error(
				detail || `fal request failed with status ${response.status}`
			);
		}
		return body as T & Record<string, unknown>;
	} finally {
		clearTimeout(timeout);
	}
}

interface FalSubmitResult {
	request_id: string;
	response_url?: string;
	status_url?: string;
}

function falSubmit(
	apiKey: string,
	model: string,
	input: Record<string, unknown>
): Promise<FalSubmitResult> {
	return falRequest<FalSubmitResult>(apiKey, `${FAL_QUEUE_BASE}/${model}`, {
		method: "POST",
		body: JSON.stringify(input),
	});
}

async function falPollUntilDone(
	apiKey: string,
	submit: FalSubmitResult,
	model: string,
	timeoutMs: number,
	pollMs: number
): Promise<Record<string, unknown>> {
	const statusUrl =
		submit.status_url ??
		`${FAL_QUEUE_BASE}/${model}/requests/${submit.request_id}/status`;
	const responseUrl =
		submit.response_url ??
		`${FAL_QUEUE_BASE}/${model}/requests/${submit.request_id}`;

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const status = await falRequest<{ status: string; error?: string }>(
			apiKey,
			statusUrl
		);
		if (typeof status.error === "string" && status.error.length > 0) {
			throw new Error(`fal job failed: ${status.error}`);
		}
		if (status.status === "COMPLETED") {
			return falRequest<Record<string, unknown>>(apiKey, responseUrl);
		}
		await sleep(pollMs);
	}
	throw new Error(`fal job timed out after ${timeoutMs}ms`);
}

async function generateReferenceImageFal(
	apiKey: string,
	prompt: string
): Promise<string> {
	const submit = await falSubmit(apiKey, "fal-ai/flux/dev", {
		prompt,
		image_size: "portrait_4_3",
		num_inference_steps: 28,
		guidance_scale: 3.5,
		num_images: 1,
		enable_safety_checker: false,
		output_format: "jpeg",
	});
	const result = await falPollUntilDone(
		apiKey,
		submit,
		"fal-ai/flux/dev",
		DEFAULT_DATASET_TIMEOUT_MS,
		DEFAULT_DATASET_POLL_MS
	);
	const images = result.images as Array<{ url?: string }> | undefined;
	const url = images?.[0]?.url;
	if (!url) {
		throw new Error("fal flux/dev returned no images");
	}
	return url;
}

function downloadAsBuffer(url: string): Promise<Uint8Array> {
	return retry(async () => {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download: ${response.status}`);
		}
		return new Uint8Array(await response.arrayBuffer());
	});
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

const UPLOAD_TIMEOUT_MS = 600_000;
const UPLOAD_RETRY_ATTEMPTS = 5;

async function uploadZipToFalStorage(
	apiKey: string,
	zipData: Uint8Array,
	filename: string
): Promise<string> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
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
				`fal-storage-upload attempt ${attempt}/${UPLOAD_RETRY_ATTEMPTS} failed:`,
				lastError.message
			);
			if (attempt < UPLOAD_RETRY_ATTEMPTS) {
				await sleep(DEFAULT_RETRY_DELAY_MS * attempt);
			}
		}
	}
	throw lastError ?? new Error("fal storage upload exhausted retries");
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
	const { writeFile, unlink } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const { tmpdir } = await import("node:os");
	const { execSync } = await import("node:child_process");

	const key = `datasets/${filename}`;
	const tmpPath = join(tmpdir(), `fal-dataset-${Date.now()}.zip`);

	try {
		await writeFile(tmpPath, zipData);

		const uploadUrl = `${s3Config.endpoint}/${s3Config.bucket}/${key}`;
		const cmd = [
			"curl",
			"-sf",
			"--max-time",
			"300",
			"-X",
			"PUT",
			"-H",
			"Content-Type: application/zip",
			"--aws-sigv4",
			`aws:amz:${s3Config.region}:s3`,
			"--user",
			`${s3Config.accessKey}:${s3Config.secretKey}`,
			"-T",
			tmpPath,
			uploadUrl,
		]
			.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
			.join(" ");

		execSync(cmd, { timeout: 300_000 });
		return `${s3Config.publicUrl}/${key}`;
	} finally {
		unlink(tmpPath).catch(() => undefined);
	}
}

export class FalZibLoraTrainingRunner {
	private readonly apiKey: string;
	private readonly personsApiBaseUrl: string;
	private readonly trainingControlToken: string;
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
		personsApiBaseUrl: string;
		trainingControlToken: string;
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
		this.personsApiBaseUrl = options.personsApiBaseUrl;
		this.trainingControlToken = options.trainingControlToken;
		this.s3Config = options.s3Config;
		this.logger = options.logger ?? console;
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

	async run(input: StartInput) {
		const parsed = startFalZibLoraTrainingSchema.parse(input);
		const triggerWord =
			parsed.triggerWord ??
			sanitizeSegment(parsed.personSlug).replace(/-/gu, "_");

		try {
			const outputName =
				parsed.outputName ??
				`${sanitizeSegment(parsed.personSlug)}-zib-lora-${Date.now()}`;
			const baseReferencePrompt = buildReferencePrompt({
				description: parsed.description,
				personName: parsed.personName,
				referencePrompt: parsed.referencePrompt,
			});

			this.logger.info("fal-zib-lora.generating-references", {
				personId: parsed.personId,
				count: REFERENCE_COUNT,
			});

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: { status: "generating", triggerWord },
			});

			const referenceImageUrls: string[] = [];
			for (const suffix of REFERENCE_VARIANT_SUFFIXES.slice(
				0,
				REFERENCE_COUNT
			)) {
				const prompt = `${baseReferencePrompt}, ${suffix}`;
				const url = await generateReferenceImageFal(this.apiKey, prompt);
				referenceImageUrls.push(url);
				this.logger.info("fal-zib-lora.reference-generated", {
					personId: parsed.personId,
					index: referenceImageUrls.length,
					total: REFERENCE_COUNT,
				});

				await this.sendTrainingEvent({
					personId: parsed.personId,
					event: {
						referenceImageUrls: [
							parsed.referencePhotoUrl,
							...referenceImageUrls,
						],
						status: "generating",
						triggerWord,
					},
				});
			}

			this.logger.info("fal-zib-lora.downloading-dataset", {
				personId: parsed.personId,
				imageCount: referenceImageUrls.length + 1,
			});

			const refPhoto = await downloadAsBuffer(parsed.referencePhotoUrl);
			const refExt =
				parsed.referencePhotoUrl.match(
					referenceImageUrlExtensionPattern
				)?.[0] ?? ".jpg";
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

			this.logger.info("fal-zib-lora.uploading-dataset", {
				personId: parsed.personId,
				zipSizeBytes: zipData.length,
				method: this.s3Config ? "s3" : "fal-storage",
			});

			const datasetUrl = this.s3Config
				? await uploadZipToS3(
						zipData,
						`${outputName}-dataset.zip`,
						this.s3Config
					)
				: await uploadZipToFalStorage(
						this.apiKey,
						zipData,
						`${outputName}-dataset.zip`
					);

			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: {
					datasetUrl,
					referenceImageUrls: [parsed.referencePhotoUrl, ...referenceImageUrls],
					status: "training",
					triggerWord,
				},
			});

			this.logger.info("fal-zib-lora.starting-training", {
				personId: parsed.personId,
				steps: Number(
					process.env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS
				),
			});

			const trainingSteps = Number(
				process.env.PERSON_LORA_TRAINING_STEPS ?? DEFAULT_TRAINING_STEPS
			);
			const trainingModel = "fal-ai/z-image-trainer";
			const trainingSubmit = await falSubmit(this.apiKey, trainingModel, {
				image_data_url: datasetUrl,
				steps: trainingSteps,
				default_caption: captionContent,
				learning_rate: 0.0001,
			});

			this.logger.info("fal-zib-lora.training-started", {
				personId: parsed.personId,
				requestId: trainingSubmit.request_id,
			});

			const trainingResult = await falPollUntilDone(
				this.apiKey,
				trainingSubmit,
				trainingModel,
				DEFAULT_TRAINING_TIMEOUT_MS,
				DEFAULT_TRAINING_POLL_MS
			);

			const diffusersLoraFile = trainingResult.diffusers_lora_file as
				| { url?: string }
				| undefined;
			const loraUrl = diffusersLoraFile?.url;
			if (!loraUrl) {
				throw new Error(
					"ZIB LoRA training completed but no weights URL was returned"
				);
			}

			this.logger.info("fal-zib-lora.training-completed", {
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
					triggerWord,
				},
			});
		} catch (error) {
			const errorSummary =
				error instanceof Error ? error.message : "Fal ZIB LoRA training failed";
			this.logger.error("fal-zib-lora.failed", {
				personId: parsed.personId,
				error: errorSummary,
			});
			await this.sendTrainingEvent({
				personId: parsed.personId,
				event: { errorSummary, status: "failed", triggerWord },
			});
			throw error;
		}
	}
}
