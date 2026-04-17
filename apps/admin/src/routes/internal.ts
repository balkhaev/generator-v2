import { env } from "@generator/env/server";
import {
	cacheExternalLoraToS3,
	type S3StorageConfig,
} from "@generator/storage";
import { Hono } from "hono";
import type { LoraRegistryService } from "@/domain/loras";
import type { PersonLoraTrainingControl } from "@/domain/person-lora-training-control";
import { createLoraSourceResolver } from "@/providers/lora-source-resolver";
import { resolveLoraListQuery } from "@/routes/loras";

const bearerPrefixPattern = /^Bearer\s+/iu;

export function createInternalRoutes(
	service: PersonLoraTrainingControl,
	s3Config?: S3StorageConfig,
	loraRegistry?: LoraRegistryService
) {
	const app = new Hono();

	const isAuthorized = (token: string | undefined) =>
		token === env.TRAINING_CONTROL_TOKEN;

	app.post("/person-lora-trainings", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		try {
			const payload = await c.req.json();
			return c.json(await service.enqueue(payload), 202);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Unable to enqueue training job.",
				},
				400
			);
		}
	});

	app.get("/loras", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		if (!loraRegistry) {
			return c.json({ loras: [] });
		}

		const query = resolveLoraListQuery(c);
		const loras = await loraRegistry.list(query);
		return c.json({ loras });
	});

	app.post("/cache-lora", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		if (!s3Config) {
			return c.json({ error: "S3 is not configured" }, 503);
		}

		try {
			const body = await c.req.json<{ sourceUrl?: string }>();
			if (!body.sourceUrl || typeof body.sourceUrl !== "string") {
				return c.json({ error: "sourceUrl is required" }, 400);
			}
			const source = await createLoraSourceResolver({
				civitaiApiKey: env.CIVITAI_API_KEY,
				huggingFaceToken: env.HUGGINGFACE_TOKEN,
			}).resolve({
				baseModel: "other",
				sourceProvider: "auto",
				sourceUrl: body.sourceUrl,
			});
			const result = await cacheExternalLoraToS3(source.downloadUrl, s3Config, {
				headers: source.downloadHeaders,
			});
			return c.json({ url: result.url, sizeBytes: result.sizeBytes });
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "Failed to cache LoRA.",
				},
				500
			);
		}
	});

	return app;
}
