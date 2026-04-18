import { env } from "@generator/env/server";
import { createRedisConnection } from "@generator/queue";
import { createStudioGrokClient } from "@/clients/grok";
import { createStudioOpenRouterClient } from "@/clients/openrouter";
import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";

const REDIS_KEY = "admin:prompt-enhance-provider";

let redisSingleton: ReturnType<typeof createRedisConnection> | null = null;

function getRedis(): ReturnType<typeof createRedisConnection> | null {
	if (redisSingleton) {
		return redisSingleton;
	}
	try {
		redisSingleton = createRedisConnection(env.REDIS_URL);
		return redisSingleton;
	} catch {
		return null;
	}
}

async function readProviderFromRedis(): Promise<"grok" | "openrouter" | null> {
	const redis = getRedis();
	if (!redis) {
		return null;
	}
	try {
		const value = await redis.get(REDIS_KEY);
		if (value === "openrouter" || value === "grok") {
			return value;
		}
	} catch {
		// ignore redis errors — fall back to env default
	}
	return null;
}

export async function resolveStudioPromptEnhanceClient(): Promise<
	PromptEnhanceClient | undefined
> {
	const fromRedis = await readProviderFromRedis();
	const provider = fromRedis ?? env.PROMPT_ENHANCE_PROVIDER;

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
