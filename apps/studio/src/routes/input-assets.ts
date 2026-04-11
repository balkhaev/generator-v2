import { mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { StudioInputAssetRecord } from "@generator/contracts/studio";
import { normalizeS3RuntimeEnv } from "@generator/env/server";
import { file as bunFile, write as bunWrite, S3Client } from "bun";
import { Hono } from "hono";

const LOCAL_UPLOAD_DIRECTORY = resolve(
	process.cwd(),
	".artifacts",
	"studio-inputs"
);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const imageExtensionByMimeType: Record<string, string> = {
	"image/avif": ".avif",
	"image/gif": ".gif",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
};
const INPUT_ASSET_PREFIX = "studio-inputs";
const fileExtensionPattern = /\.[a-z0-9]+$/i;
const nonAlphaNumericPattern = /[^a-z0-9]+/g;
const safeFileNamePattern = /^[a-z0-9-]+\.[a-z0-9]+$/i;
const trimDashPattern = /^-+|-+$/g;
const trailingSlashesPattern = /\/+$/u;

function sanitizeFileStem(fileName: string) {
	return fileName
		.replace(fileExtensionPattern, "")
		.toLowerCase()
		.replace(nonAlphaNumericPattern, "-")
		.replace(trimDashPattern, "")
		.slice(0, 48);
}

function getStoredFileName(file: File) {
	const fileStem = sanitizeFileStem(file.name) || "studio-input";
	const extension =
		extname(file.name).toLowerCase() ||
		imageExtensionByMimeType[file.type] ||
		".png";

	return `${Date.now()}-${crypto.randomUUID()}-${fileStem}${extension}`;
}

function getContentType(file: File) {
	return file.type || "application/octet-stream";
}

function resolveS3Config() {
	const e = normalizeS3RuntimeEnv(process.env);
	const accessKeyId = e.S3_ACCESS_KEY_ID?.trim();
	const secretAccessKey = e.S3_SECRET_ACCESS_KEY?.trim();
	const endpoint = e.S3_ENDPOINT?.trim();
	const region = e.S3_REGION?.trim();
	const bucket = e.S3_BUCKET?.trim();
	const publicBaseUrl =
		e.S3_PUBLIC_URL?.trim() ??
		(endpoint && bucket
			? `${endpoint.replace(trailingSlashesPattern, "")}/${bucket}`
			: undefined);

	if (
		!(
			accessKeyId &&
			secretAccessKey &&
			endpoint &&
			region &&
			bucket &&
			publicBaseUrl
		)
	) {
		return null;
	}

	return {
		accessKeyId,
		bucket,
		endpoint,
		publicBaseUrl,
		region,
		secretAccessKey,
	};
}

function getS3UploadContext() {
	const storage = resolveS3Config();

	if (!storage) {
		return null;
	}

	return {
		client: new S3Client({
			accessKeyId: storage.accessKeyId,
			bucket: storage.bucket,
			endpoint: storage.endpoint,
			region: storage.region,
			secretAccessKey: storage.secretAccessKey,
		}),
		publicBaseUrl: storage.publicBaseUrl,
	};
}

async function persistUpload(
	file: File,
	requestUrl: string,
	logger?: Pick<Console, "warn">
): Promise<StudioInputAssetRecord> {
	const storedFileName = getStoredFileName(file);
	const contentType = getContentType(file);
	const sizeBytes = file.size;
	const s3Context = getS3UploadContext();

	if (s3Context) {
		try {
			const storageKey = `${INPUT_ASSET_PREFIX}/${storedFileName}`;
			const publicUrl = new URL(
				storageKey,
				`${s3Context.publicBaseUrl}/`
			).toString();

			await s3Context.client.write(storageKey, file);

			return {
				contentType,
				fileName: storedFileName,
				sizeBytes,
				storage: "s3",
				url: publicUrl,
			};
		} catch (error) {
			logger?.warn(
				`studio.input-asset.upload-s3-fallback:${error instanceof Error ? error.message : "unknown"}`
			);
		}
	}

	await mkdir(LOCAL_UPLOAD_DIRECTORY, { recursive: true });
	await bunWrite(resolve(LOCAL_UPLOAD_DIRECTORY, storedFileName), file);

	return {
		contentType,
		fileName: storedFileName,
		sizeBytes,
		storage: "local",
		url: new URL(`/api/input-assets/${storedFileName}`, requestUrl).toString(),
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

function isSafeLocalFileName(fileName: string) {
	return safeFileNamePattern.test(fileName);
}

export function createInputAssetRoutes(options?: {
	logger?: Pick<Console, "warn">;
}) {
	const app = new Hono();

	app.post("/", async (c) => {
		try {
			const payload = await c.req.formData();
			const file = payload.get("file");
			const upload = file instanceof File ? file : null;

			validateUploadedFile(upload);
			const stored = await persistUpload(
				upload as File,
				c.req.url,
				options?.logger
			);

			return c.json({ upload: stored }, 201);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "Unable to upload image.",
				},
				400
			);
		}
	});

	app.get("/:fileName", async (c) => {
		const fileName = c.req.param("fileName");

		if (!isSafeLocalFileName(fileName)) {
			return c.json({ error: "Input asset not found." }, 404);
		}

		const file = bunFile(resolve(LOCAL_UPLOAD_DIRECTORY, fileName));

		if (!(await file.exists())) {
			return c.json({ error: "Input asset not found." }, 404);
		}

		return new Response(file, {
			headers: {
				"cache-control": "public, max-age=31536000, immutable",
				"content-type": file.type || "application/octet-stream",
			},
		});
	});

	return app;
}
