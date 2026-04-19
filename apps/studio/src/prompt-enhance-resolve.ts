import { env } from "@generator/env/server";
import type { RuntimeConfigClient } from "@generator/runtime-config/client";
import { createRuntimeConfigClient } from "@generator/runtime-config/client";
import type { PromptEnhanceSettings } from "@generator/runtime-config/domains";
import { createStudioGrokClient } from "@/clients/grok";
import { createStudioOpenRouterClient } from "@/clients/openrouter";
import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";

let runtimeConfigClient: RuntimeConfigClient | null = null;
let warnedNoAdmin = false;

function getRuntimeConfigClient(): RuntimeConfigClient | null {
	if (runtimeConfigClient) {
		return runtimeConfigClient;
	}
	const adminUrl = env.ADMIN_API_URL?.trim();
	const token = env.RUNTIME_CONFIG_INTERNAL_TOKEN?.trim();
	if (!(adminUrl && token)) {
		if (!warnedNoAdmin) {
			console.warn("studio.prompt-enhance.runtime-config_disabled", {
				hint: "Set ADMIN_API_URL + RUNTIME_CONFIG_INTERNAL_TOKEN to enable centralized config.",
			});
			warnedNoAdmin = true;
		}
		return null;
	}
	runtimeConfigClient = createRuntimeConfigClient({
		adminApiUrl: adminUrl,
		internalToken: token,
		logger: console,
		redisUrl: env.REDIS_URL,
	});
	return runtimeConfigClient;
}

export async function resolveStudioPromptEnhanceClient(): Promise<
	PromptEnhanceClient | undefined
> {
	const client = getRuntimeConfigClient();
	if (!client) {
		return resolveFromEnvFallback();
	}
	let snapshot: Awaited<ReturnType<RuntimeConfigClient["get"]>>;
	try {
		snapshot = await client.get("prompt-enhance-studio");
	} catch (error) {
		console.warn("studio.prompt-enhance.runtime-config_fetch_failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		return resolveFromEnvFallback();
	}
	const settings = snapshot.settings as PromptEnhanceSettings;
	if (settings.provider === "openrouter") {
		const orKey =
			snapshot.credentials.openrouter?.apiKey ?? env.OPENROUTER_API_KEY?.trim();
		if (orKey) {
			return createStudioOpenRouterClient({
				apiKey: orKey,
				appName: env.OPENROUTER_APP_NAME ?? null,
				httpReferer: env.OPENROUTER_HTTP_REFERER ?? null,
				model: settings.openrouterModel ?? env.OPENROUTER_MODEL,
			});
		}
	}
	const xai = snapshot.credentials.xai?.apiKey ?? env.XAI_API_KEY?.trim();
	if (xai) {
		return createStudioGrokClient({ apiKey: xai });
	}
	return undefined;
}

/**
 * Last-resort fallback when admin-api is unreachable. Reads provider and
 * credentials from env so a single misconfiguration on admin-api can't
 * silently disable enhance for everybody. Writes from the admin UI take
 * effect once admin-api comes back online.
 */
function resolveFromEnvFallback(): PromptEnhanceClient | undefined {
	const provider = env.PROMPT_ENHANCE_PROVIDER;
	if (provider === "openrouter") {
		const orKey = env.OPENROUTER_API_KEY?.trim();
		if (orKey) {
			return createStudioOpenRouterClient({
				apiKey: orKey,
				appName: env.OPENROUTER_APP_NAME ?? null,
				httpReferer: env.OPENROUTER_HTTP_REFERER ?? null,
				model: env.OPENROUTER_MODEL,
			});
		}
	}
	const xai = env.XAI_API_KEY?.trim();
	if (xai) {
		return createStudioGrokClient({ apiKey: xai });
	}
	return undefined;
}
