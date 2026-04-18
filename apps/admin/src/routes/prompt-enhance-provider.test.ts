import { describe, expect, test } from "bun:test";

import { createInMemoryPromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import { createPromptEnhanceProviderRoutes } from "@/routes/prompt-enhance-provider";

const envDefaults = {
	grokConfigured: true,
	openRouterConfigured: true,
	openRouterModelEnvDefault: "openai/gpt-4o-mini",
};

describe("prompt-enhance-provider routes", () => {
	test("GET / returns snapshot with provider", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({
			promptEnhanceEnv: envDefaults,
			settings,
		});
		const response = await app.request("/");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			grokConfigured: boolean;
			openRouterModel: string;
			provider: string;
		};
		expect(body.provider).toBe("grok");
		expect(body.grokConfigured).toBe(true);
		expect(body.openRouterModel).toBe("openai/gpt-4o-mini");
	});

	test("PUT / persists provider", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({
			promptEnhanceEnv: envDefaults,
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

	test("PUT / persists openRouterModel only", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({
			promptEnhanceEnv: envDefaults,
			settings,
		});
		const response = await app.request("/", {
			body: JSON.stringify({ openRouterModel: "anthropic/claude-3.5-sonnet" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(200);
		expect(await settings.getOpenRouterModel()).toBe(
			"anthropic/claude-3.5-sonnet"
		);
		expect(await settings.getProvider()).toBe("grok");
	});

	test("PUT / rejects unknown provider", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({
			promptEnhanceEnv: envDefaults,
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
