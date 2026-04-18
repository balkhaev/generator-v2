import { describe, expect, test } from "bun:test";

import { createInMemoryPromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import { createPromptEnhanceProviderRoutes } from "@/routes/prompt-enhance-provider";

describe("prompt-enhance-provider routes", () => {
	test("GET / returns snapshot with provider", async () => {
		const settings = createInMemoryPromptEnhanceSettings("grok");
		const app = createPromptEnhanceProviderRoutes({
			promptEnhanceEnv: {
				grokConfigured: true,
				openRouterConfigured: false,
				openRouterModel: "openai/gpt-4o-mini",
			},
			settings,
		});
		const response = await app.request("/");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			grokConfigured: boolean;
			provider: string;
		};
		expect(body.provider).toBe("grok");
		expect(body.grokConfigured).toBe(true);
	});

	test("PUT / persists provider", async () => {
		const settings = createInMemoryPromptEnhanceSettings("grok");
		const app = createPromptEnhanceProviderRoutes({
			promptEnhanceEnv: {
				grokConfigured: true,
				openRouterConfigured: true,
				openRouterModel: "openai/gpt-4o-mini",
			},
			settings,
		});
		const response = await app.request("/", {
			body: JSON.stringify({ provider: "openrouter" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(200);
		expect(await settings.getProvider()).toBe("openrouter");
	});

	test("PUT / rejects unknown provider", async () => {
		const settings = createInMemoryPromptEnhanceSettings("grok");
		const app = createPromptEnhanceProviderRoutes({
			promptEnhanceEnv: {
				grokConfigured: true,
				openRouterConfigured: false,
				openRouterModel: "openai/gpt-4o-mini",
			},
			settings,
		});
		const response = await app.request("/", {
			body: JSON.stringify({ provider: "other" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(400);
		expect(await settings.getProvider()).toBe("grok");
	});
});
