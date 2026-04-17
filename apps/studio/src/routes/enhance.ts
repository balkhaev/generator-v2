import { Hono } from "hono";
import { z } from "zod";

import type { StudioGrokClient } from "@/clients/grok";

const enhanceRequestSchema = z.object({
	prompt: z.string().min(1).max(2000),
});

export function createEnhanceRoutes(client: StudioGrokClient | undefined) {
	const app = new Hono();

	app.post("/", async (c) => {
		if (!client) {
			return c.json(
				{ error: "Prompt enhancement is not configured on this server." },
				503
			);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be valid JSON." }, 400);
		}

		const parsed = enhanceRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
				400
			);
		}

		try {
			const enhanced = await client.enhancePrompt(parsed.data.prompt);
			return c.json({ enhanced });
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "Failed to enhance prompt",
				},
				502
			);
		}
	});

	return app;
}
