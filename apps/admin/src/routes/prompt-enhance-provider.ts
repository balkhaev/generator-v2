import {
	PROMPT_ENHANCE_PROVIDER_NAMES,
	type PromptEnhanceSettingsSnapshot,
} from "@generator/contracts/admin";
import { Hono } from "hono";
import { z } from "zod";

import type { PromptEnhanceSettings } from "@/domain/prompt-enhance-settings";

const putBodySchema = z
	.object({
		openRouterModel: z
			.string()
			.trim()
			.min(1)
			.max(200)
			.regex(/^[a-zA-Z0-9_.:/-]+$/)
			.optional(),
		provider: z.enum(PROMPT_ENHANCE_PROVIDER_NAMES).optional(),
	})
	.refine((v) => v.provider !== undefined || v.openRouterModel !== undefined, {
		message: "Provide provider and/or openRouterModel",
	});

async function buildSnapshot(deps: {
	promptEnhanceEnv: Omit<
		PromptEnhanceSettingsSnapshot,
		"provider" | "openRouterModel"
	>;
	settings: PromptEnhanceSettings;
}): Promise<PromptEnhanceSettingsSnapshot> {
	const [provider, openRouterModel] = await Promise.all([
		deps.settings.getProvider(),
		deps.settings.getOpenRouterModel(),
	]);
	return {
		...deps.promptEnhanceEnv,
		openRouterModel,
		provider,
	};
}

export function createPromptEnhanceProviderRoutes(deps: {
	promptEnhanceEnv: Omit<
		PromptEnhanceSettingsSnapshot,
		"provider" | "openRouterModel"
	>;
	settings: PromptEnhanceSettings;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		return c.json(await buildSnapshot(deps));
	});

	app.put("/", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const parsed = putBodySchema.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
				400
			);
		}

		if (parsed.data.provider !== undefined) {
			await deps.settings.setProvider(parsed.data.provider);
		}
		if (parsed.data.openRouterModel !== undefined) {
			await deps.settings.setOpenRouterModel(parsed.data.openRouterModel);
		}

		return c.json(await buildSnapshot(deps));
	});

	return app;
}
