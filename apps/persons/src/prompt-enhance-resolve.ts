/**
 * Lazy persons prompt-enhance proxy.
 *
 * Why a proxy and not a single client built at boot:
 *   - The provider switch lives in admin → settings → "Prompt enhancement"
 *     (Redis-backed runtime-config). Building a Grok-only client at boot
 *     means flipping the toggle to OpenRouter only takes effect after a
 *     full pod restart — exactly the footgun the Studio service avoided
 *     with the same proxy pattern.
 *   - We MUST NOT block app startup on admin-api availability. Every
 *     resolution is per-call, with a short in-memory TTL inside
 *     {@link createRuntimeConfigClient}; admin downtime degrades to "use
 *     the last cached snapshot" or "use env fallback", never to "persons
 *     fails to boot".
 *   - The proxy keeps the existing `GrokClient` interface so neither
 *     `PersonsService` nor `createEnhanceRoutes` need to know which LLM
 *     is on the other side of the wire.
 */

import { env } from "@generator/env/server";
import type { RuntimeConfigClient } from "@generator/runtime-config/client";
import { createRuntimeConfigClient } from "@generator/runtime-config/client";
import type { PromptEnhanceSettings } from "@generator/runtime-config/domains";

import type {
	GrokClient,
	GrokExpandPromptOptions,
	GrokRefinePromptOptions,
} from "@/clients/grok";
import { createGrokClient } from "@/clients/grok";
import { createPersonsOpenRouterClient } from "@/clients/openrouter";

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
			console.warn("persons.prompt-enhance.runtime-config_disabled", {
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

/**
 * Resolve the active provider client right now. Called once per
 * proxy method invocation. The runtime-config layer caches snapshots
 * for 60s + invalidates on Redis pub/sub, so this is sub-millisecond
 * on the hot path.
 */
async function resolvePersonsPromptEnhanceClient(): Promise<
	GrokClient | undefined
> {
	const client = getRuntimeConfigClient();
	if (!client) {
		return resolveFromEnvFallback();
	}

	let snapshot: Awaited<ReturnType<RuntimeConfigClient["get"]>>;
	try {
		snapshot = await client.get("prompt-enhance-persons");
	} catch (error) {
		console.warn("persons.prompt-enhance.runtime-config_fetch_failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		return resolveFromEnvFallback();
	}

	const settings = snapshot.settings as PromptEnhanceSettings;
	if (settings.provider === "openrouter") {
		const orKey =
			snapshot.credentials.openrouter?.apiKey ?? env.OPENROUTER_API_KEY?.trim();
		if (orKey) {
			return createPersonsOpenRouterClient({
				apiKey: orKey,
				appName: env.OPENROUTER_APP_NAME ?? null,
				httpReferer: env.OPENROUTER_HTTP_REFERER ?? null,
				model: settings.openrouterModel ?? env.OPENROUTER_MODEL,
			});
		}
		console.warn("persons.prompt-enhance.openrouter_missing_key", {
			hint: "admin selected openrouter but no API key is configured; falling back to grok.",
		});
	}

	const xai = snapshot.credentials.xai?.apiKey ?? env.XAI_API_KEY?.trim();
	if (xai) {
		return createGrokClient({ apiKey: xai });
	}
	return undefined;
}

/**
 * Last-resort fallback when admin-api is unreachable. Reads provider
 * and credentials from env so a single misconfiguration on admin-api
 * can't silently disable enhance for everybody. Writes from the admin
 * UI take effect once admin-api comes back online.
 */
function resolveFromEnvFallback(): GrokClient | undefined {
	const provider = env.PROMPT_ENHANCE_PROVIDER;
	if (provider === "openrouter") {
		const orKey = env.OPENROUTER_API_KEY?.trim();
		if (orKey) {
			return createPersonsOpenRouterClient({
				apiKey: orKey,
				appName: env.OPENROUTER_APP_NAME ?? null,
				httpReferer: env.OPENROUTER_HTTP_REFERER ?? null,
				model: env.OPENROUTER_MODEL,
			});
		}
	}
	const xai = env.XAI_API_KEY?.trim();
	if (xai) {
		return createGrokClient({ apiKey: xai });
	}
	return undefined;
}

/**
 * Returns a `GrokClient`-shaped proxy or `undefined` when no provider
 * key is reachable in any path (env nor admin runtime-config seed).
 *
 * `undefined` is propagated through to `createEnhanceRoutes`, which
 * surfaces it as 503 — matching the previous Grok-only behavior.
 */
export function createPersonsPromptEnhanceProxy(): GrokClient | undefined {
	const adminConfigured = Boolean(
		env.ADMIN_API_URL?.trim() && env.RUNTIME_CONFIG_INTERNAL_TOKEN?.trim()
	);
	const envConfigured = Boolean(
		env.XAI_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim()
	);
	if (!(adminConfigured || envConfigured)) {
		return undefined;
	}

	async function resolveOrThrow(): Promise<GrokClient> {
		const resolved = await resolvePersonsPromptEnhanceClient();
		if (!resolved) {
			throw new Error(
				"Prompt enhancement is not configured: no provider credentials available"
			);
		}
		return resolved;
	}

	return {
		async enhancePrompt(prompt: string) {
			const client = await resolveOrThrow();
			return client.enhancePrompt(prompt);
		},
		async expandPrompt(opts: GrokExpandPromptOptions) {
			const client = await resolveOrThrow();
			return client.expandPrompt(opts);
		},
		async refinePrompt(opts: GrokRefinePromptOptions) {
			const client = await resolveOrThrow();
			return client.refinePrompt(opts);
		},
	};
}
