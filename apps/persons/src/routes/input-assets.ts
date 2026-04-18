import { extname } from "node:path";
import {
	buildPublicAssetUrl,
	createS3Client,
	resolveS3StorageConfig,
	type S3ClientLike,
	type S3StorageConfig,
} from "@generator/storage";
import { Hono } from "hono";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const imageExtensionByMimeType: Record<string, string> = {
	"image/avif": ".avif",
	"image/gif": ".gif",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
};
const INPUT_ASSET_PREFIX = "persons-inputs";
const fileExtensionPattern = /\.[a-z0-9]+$/i;
const nonAlphaNumericPattern = /[^a-z0-9]+/g;
const trimDashPattern = /^-+|-+$/g;

interface PersonsInputAssetRecord {
	contentType: string;
	fileName: string;
	sizeBytes: number;
	storage: "s3";
	url: string;
}

function sanitizeFileStem(fileName: string) {
	return fileName
		.replace(fileExtensionPattern, "")
		.toLowerCase()
		.replace(nonAlphaNumericPattern, "-")
		.replace(trimDashPattern, "")
		.slice(0, 48);
}

function getStoredFileName(file: File) {
	const fileStem = sanitizeFileStem(file.name) || "persons-input";
	const extension =
		extname(file.name).toLowerCase() ||
		imageExtensionByMimeType[file.type] ||
		".png";

	return `${Date.now()}-${crypto.randomUUID()}-${fileStem}${extension}`;
}

function getContentType(file: File) {
	return file.type || "application/octet-stream";
}

interface S3UploadContext {
	client: S3ClientLike;
	config: S3StorageConfig;
}

async function persistUpload(
	file: File,
	context: S3UploadContext
): Promise<PersonsInputAssetRecord> {
	const storedFileName = getStoredFileName(file);
	const contentType = getContentType(file);
	const sizeBytes = file.size;
	const storageKey = `${INPUT_ASSET_PREFIX}/${storedFileName}`;

	await context.client.write(storageKey, file);

	return {
		contentType,
		fileName: storedFileName,
		sizeBytes,
		storage: "s3",
		url: buildPublicAssetUrl(context.config, storageKey),
	};
}

function validateUploadedFile(file: File | null): asserts file is File {
	if (!file) {
		throw new Error("Image file is required.");
	}

	if (!file.type.startsWith("image/")) {
		throw new Error("Only image uploads are supported.");
	}

	if (file.size <= 0) {
		throw new Error("Uploaded image is empty.");
	}

	if (file.size > MAX_UPLOAD_BYTES) {
		throw new Error("Uploaded image exceeds the 20 MB limit.");
	}
}

export function createInputAssetRoutes(options?: {
	logger?: Pick<Console, "warn">;
	s3Client?: S3ClientLike;
	s3Config?: S3StorageConfig;
}) {
	let context: S3UploadContext | null = null;

	function resolveContext(): S3UploadContext {
		if (context) {
			return context;
		}
		const config = options?.s3Config ?? resolveS3StorageConfig(process.env);
		context = {
			client: options?.s3Client ?? createS3Client(config),
			config,
		};
		return context;
	}

	const app = new Hono();

	app.post("/", async (c) => {
		try {
			const payload = await c.req.formData();
			const file = payload.get("file");
			const upload = file instanceof File ? file : null;

			validateUploadedFile(upload);
			const stored = await persistUpload(upload as File, resolveContext());

			return c.json({ upload: stored }, 201);
		} catch (error) {
			options?.logger?.warn(
				`persons.input-asset.upload-failed:${error instanceof Error ? error.message : "unknown"}`
			);

			return c.json(
				{
					error:
						error instanceof Error ? error.message : "Unable to upload image.",
				},
				400
			);
		}
	});

	return app;
}
