import { describe, expect, test } from "bun:test";
import type { PromptEnhanceTarget } from "@generator/contracts/admin";

import { createInMemoryPromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import { createPromptEnhanceProviderRoutes } from "@/routes/prompt-enhance-provider";

const envEntry = {
	grokConfigured: true,
	openRouterConfigured: true,
	openRouterModelEnvDefault: "openai/gpt-4o-mini",
};
const envByTarget: Record<PromptEnhanceTarget, typeof envEntry> = {
	persons: envEntry,
	studio: envEntry,
};

describe("prompt-enhance-provider routes", () => {
	test("GET / returns bundle with both targets", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({ envByTarget, settings });
		const response = await app.request("/");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			persons: { provider: string; target: string };
			studio: { provider: string; target: string };
		};
		expect(body.studio.provider).toBe("grok");
		expect(body.persons.provider).toBe("grok");
		expect(body.studio.target).toBe("studio");
		expect(body.persons.target).toBe("persons");
	});

	test("GET /:target returns single snapshot", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({ envByTarget, settings });
		const response = await app.request("/persons");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			openRouterModel: string;
			provider: string;
			target: string;
		};
		expect(body.provider).toBe("grok");
		expect(body.target).toBe("persons");
		expect(body.openRouterModel).toBe("openai/gpt-4o-mini");
	});

	test("PUT /:target persists provider for that target only", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({ envByTarget, settings });
		const response = await app.request("/studio", {
			body: JSON.stringify({ provider: "openrouter" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(200);
		expect(await settings.getProvider("studio")).toBe("openrouter");
		expect(await settings.getProvider("persons")).toBe("grok");
	});

	test("PUT /:target persists openRouterModel only", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({ envByTarget, settings });
		const response = await app.request("/persons", {
			body: JSON.stringify({ openRouterModel: "anthropic/claude-3.5-sonnet" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(200);
		expect(await settings.getOpenRouterModel("persons")).toBe(
			"anthropic/claude-3.5-sonnet"
		);
		expect(await settings.getProvider("persons")).toBe("grok");
	});

	test("PUT /:target rejects unknown provider", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({ envByTarget, settings });
		const response = await app.request("/studio", {
			body: JSON.stringify({ provider: "other" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(400);
		expect(await settings.getProvider("studio")).toBe("grok");
	});

	test("PUT rejects unknown target", async () => {
		const settings = createInMemoryPromptEnhanceSettings(
			"grok",
			"openai/gpt-4o-mini"
		);
		const app = createPromptEnhanceProviderRoutes({ envByTarget, settings });
		const response = await app.request("/somewhere", {
			body: JSON.stringify({ provider: "openrouter" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(response.status).toBe(400);
	});
});
