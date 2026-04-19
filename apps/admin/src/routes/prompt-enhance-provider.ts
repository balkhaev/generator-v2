import {
	PROMPT_ENHANCE_PROVIDER_NAMES,
	PROMPT_ENHANCE_TARGETS,
	type PromptEnhanceSettingsBundle,
	type PromptEnhanceSettingsSnapshot,
	type PromptEnhanceTarget,
} from "@generator/contracts/admin";
import { Hono } from "hono";
import { z } from "zod";

import type { PromptEnhanceSettings } from "@/domain/prompt-enhance-settings";

const targetParamSchema = z.enum(PROMPT_ENHANCE_TARGETS);

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

interface PerTargetEnv {
	grokConfigured: boolean;
	openRouterConfigured: boolean;
	openRouterModelEnvDefault: string;
}

export interface PromptEnhanceProviderRoutesDeps {
	envByTarget: Record<PromptEnhanceTarget, PerTargetEnv>;
	settings: PromptEnhanceSettings;
}

async function buildSnapshot(
	deps: PromptEnhanceProviderRoutesDeps,
	target: PromptEnhanceTarget
): Promise<PromptEnhanceSettingsSnapshot> {
	const [provider, openRouterModel] = await Promise.all([
		deps.settings.getProvider(target),
		deps.settings.getOpenRouterModel(target),
	]);
	return {
		...deps.envByTarget[target],
		openRouterModel,
		provider,
		target,
	};
}

async function buildBundle(
	deps: PromptEnhanceProviderRoutesDeps
): Promise<PromptEnhanceSettingsBundle> {
	const [studio, persons] = await Promise.all([
		buildSnapshot(deps, "studio"),
		buildSnapshot(deps, "persons"),
	]);
	return { persons, studio };
}

export function buildPromptEnhanceBundle(
	deps: PromptEnhanceProviderRoutesDeps
): Promise<PromptEnhanceSettingsBundle> {
	return buildBundle(deps);
}

export function createPromptEnhanceProviderRoutes(
	deps: PromptEnhanceProviderRoutesDeps
) {
	const app = new Hono();

	app.get("/", async (c) => {
		return c.json(await buildBundle(deps));
	});

	app.get("/:target", async (c) => {
		const parsedTarget = targetParamSchema.safeParse(c.req.param("target"));
		if (!parsedTarget.success) {
			return c.json({ error: "Unknown target" }, 400);
		}
		return c.json(await buildSnapshot(deps, parsedTarget.data));
	});

	app.put("/:target", async (c) => {
		const parsedTarget = targetParamSchema.safeParse(c.req.param("target"));
		if (!parsedTarget.success) {
			return c.json({ error: "Unknown target" }, 400);
		}
		const target = parsedTarget.data;

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
			await deps.settings.setProvider(target, parsed.data.provider);
		}
		if (parsed.data.openRouterModel !== undefined) {
			await deps.settings.setOpenRouterModel(
				target,
				parsed.data.openRouterModel
			);
		}

		return c.json(await buildSnapshot(deps, target));
	});

	return app;
}
