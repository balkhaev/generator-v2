import {
	PROMPT_ENHANCE_PROVIDER_NAMES,
	type PromptEnhanceProviderName,
	type PromptEnhanceSettingsSnapshot,
} from "@generator/contracts/admin";
import { Hono } from "hono";

import type { PromptEnhanceSettings } from "@/domain/prompt-enhance-settings";

function isPromptEnhanceProvider(
	value: unknown
): value is PromptEnhanceProviderName {
	return (
		typeof value === "string" &&
		(PROMPT_ENHANCE_PROVIDER_NAMES as readonly string[]).includes(value)
	);
}

export function createPromptEnhanceProviderRoutes(deps: {
	promptEnhanceEnv: Omit<PromptEnhanceSettingsSnapshot, "provider">;
	settings: PromptEnhanceSettings;
}) {
	const app = new Hono();

	app.get("/", async (c) => {
		const provider = await deps.settings.getProvider();
		const snapshot: PromptEnhanceSettingsSnapshot = {
			...deps.promptEnhanceEnv,
			provider,
		};
		return c.json(snapshot);
	});

	app.put("/", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const provider =
			body && typeof body === "object"
				? (body as Record<string, unknown>).provider
				: undefined;

		if (!isPromptEnhanceProvider(provider)) {
			return c.json(
				{
					error: `provider must be one of: ${PROMPT_ENHANCE_PROVIDER_NAMES.join(", ")}`,
				},
				400
			);
		}

		await deps.settings.setProvider(provider);
		const snapshot: PromptEnhanceSettingsSnapshot = {
			...deps.promptEnhanceEnv,
			provider,
		};
		return c.json(snapshot);
	});

	return app;
}
