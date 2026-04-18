import { env } from "@generator/env/server";
import { createRedisConnection } from "@generator/queue";
import { createStudioGrokClient } from "@/clients/grok";
import { createStudioOpenRouterClient } from "@/clients/openrouter";
import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";

const REDIS_KEY_PROVIDER = "admin:prompt-enhance-provider";
const REDIS_KEY_OPENROUTER_MODEL = "admin:prompt-enhance-openrouter-model";

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
		const value = await redis.get(REDIS_KEY_PROVIDER);
		if (value === "openrouter" || value === "grok") {
			return value;
		}
	} catch {
		// ignore redis errors — fall back to env default
	}
	return null;
}

async function readOpenRouterModelFromRedis(): Promise<string | null> {
	const redis = getRedis();
	if (!redis) {
		return null;
	}
	try {
		const value = await redis.get(REDIS_KEY_OPENROUTER_MODEL);
		const trimmed = value?.trim();
		return trimmed && trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

export async function resolveStudioPromptEnhanceClient(): Promise<
	PromptEnhanceClient | undefined
> {
	const fromRedis = await readProviderFromRedis();
	const provider = fromRedis ?? env.PROMPT_ENHANCE_PROVIDER;

	if (provider === "openrouter") {
		const orKey = env.OPENROUTER_API_KEY?.trim();
		if (orKey) {
			const modelFromRedis = await readOpenRouterModelFromRedis();
			const model = modelFromRedis ?? env.OPENROUTER_MODEL;
			return createStudioOpenRouterClient({
				apiKey: orKey,
				appName: env.OPENROUTER_APP_NAME ?? null,
				httpReferer: env.OPENROUTER_HTTP_REFERER ?? null,
				model,
			});
		}
	}

	const xai = env.XAI_API_KEY?.trim();
	if (xai) {
		return createStudioGrokClient({ apiKey: xai });
	}

	return undefined;
}
