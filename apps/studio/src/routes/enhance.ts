import { Hono } from "hono";
import { z } from "zod";

import type { StudioGrokClient } from "@/clients/grok";

const enhanceRequestSchema = z.object({
	imageUrl: z.url("Image URL must be a valid URL").optional(),
	prompt: z.string().min(1).max(2000),
});

function shouldFallbackVisionToText(error: unknown): boolean {
	const msg = (
		error instanceof Error ? error.message : String(error)
	).toLowerCase();
	return (
		msg.includes("403") ||
		msg.includes("forbidden") ||
		msg.includes("usage guidelines") ||
		msg.includes("does not have permission") ||
		msg.includes("content violates") ||
		msg.includes("policy violation") ||
		msg.includes("moderation") ||
		msg.includes("safety system")
	);
}

async function runEnhancement(
	client: StudioGrokClient,
	input: z.infer<typeof enhanceRequestSchema>
): Promise<{
	enhanced: string;
	mode: "text" | "vision";
	notice: string | null;
}> {
	if (!input.imageUrl) {
		const enhanced = await client.enhancePrompt(input.prompt);
		return { enhanced, mode: "text", notice: null };
	}
	try {
		const enhanced = await client.enhancePromptWithImage(
			input.prompt,
			input.imageUrl
		);
		return { enhanced, mode: "vision", notice: null };
	} catch (visionError) {
		if (!shouldFallbackVisionToText(visionError)) {
			throw visionError;
		}
		const enhanced = await client.enhancePrompt(input.prompt);
		return {
			enhanced,
			mode: "text",
			notice:
				"Grok could not use the image (policy or provider limits). Prompt was enhanced without vision.",
		};
	}
}

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
			const out = await runEnhancement(client, parsed.data);
			return c.json({
				enhanced: out.enhanced,
				mode: out.mode,
				...(out.notice ? { notice: out.notice } : {}),
			});
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
