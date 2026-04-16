import { Hono } from "hono";

import type { PersonLoraTrainingControl } from "@/domain/person-lora-training-control";
import {
	cacheExternalLoraToS3,
	type S3Config,
} from "@/providers/lora-training-assets";

const bearerPrefixPattern = /^Bearer\s+/iu;

export function createInternalRoutes(
	service: PersonLoraTrainingControl,
	s3Config?: S3Config
) {
	const app = new Hono();

	app.post("/person-lora-trainings", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (
			token !==
			(process.env.TRAINING_CONTROL_TOKEN ?? "local-training-control-token")
		) {
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

	app.post("/cache-lora", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (
			token !==
			(process.env.TRAINING_CONTROL_TOKEN ?? "local-training-control-token")
		) {
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
			const result = await cacheExternalLoraToS3(body.sourceUrl, s3Config);
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
