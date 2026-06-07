import { Hono } from "hono";
import { z } from "zod";

import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";
import { EnhanceOutputError } from "@/clients/prompt-enhance-output";

const enhanceRequestSchema = z.object({
	imageUrl: z.url("Image URL must be a valid URL").optional(),
	prompt: z.string().min(1).max(2000),
});

function shouldFallbackVisionToText(error: unknown): boolean {
	// A validated-output rejection that survived the whole vision fallback chain
	// (every model refused / dumped reasoning / returned junk) is still better
	// served as a text-only enhance than a 502 — the user gets a usable prompt,
	// just without image grounding.
	if (error instanceof EnhanceOutputError) {
		return true;
	}
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
		msg.includes("safety system") ||
		msg.includes("returned analysis instead of a rewritten prompt") ||
		// Reasoning models or non-vision-capable text models often answer a
		// vision request with HTTP 200 + empty content. Falling back to text
		// is strictly better than a 502 — the user still gets an enhanced
		// prompt, just without grounding in the reference image.
		msg.includes("empty content") ||
		msg.includes("could not be processed") ||
		msg.includes("image(s)")
	);
}

async function runEnhancement(
	client: PromptEnhanceClient,
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
				"Vision prompt enhance failed or was declined by the provider. Prompt was enhanced without vision — it may not be tied to the input frame.",
		};
	}
}

export function createEnhanceRoutes(deps: {
	logger?: Pick<Console, "info" | "warn">;
	resolveClient: () => Promise<PromptEnhanceClient | undefined>;
}) {
	const app = new Hono();
	const logger = deps.logger;

	app.post("/", async (c) => {
		const client = await deps.resolveClient();
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

		const startedAt = Date.now();
		const requestedVision = Boolean(parsed.data.imageUrl);
		try {
			const out = await runEnhancement(client, parsed.data);
			logger?.info?.("studio.enhance.ok", {
				durationMs: Date.now() - startedAt,
				fellBackToText: requestedVision && out.mode === "text",
				mode: out.mode,
				requestedVision,
			});
			return c.json({
				enhanced: out.enhanced,
				mode: out.mode,
				...(out.notice ? { notice: out.notice } : {}),
			});
		} catch (error) {
			logger?.warn?.("studio.enhance.failed", {
				durationMs: Date.now() - startedAt,
				message: error instanceof Error ? error.message : String(error),
				requestedVision,
			});
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
