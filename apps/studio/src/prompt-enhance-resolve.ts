import { env } from "@generator/env/server";
import { createAppRedisConnection } from "@generator/queue";
import { createStudioGrokClient } from "@/clients/grok";
import { createStudioOpenRouterClient } from "@/clients/openrouter";
import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";

const REDIS_KEY_PROVIDER = "admin:prompt-enhance-provider";
const REDIS_KEY_OPENROUTER_MODEL = "admin:prompt-enhance-openrouter-model";

/**
 * Cap for a single Redis lookup on the enhance hot path. Has to stay well
 * below any user-visible request timeout: if the override key is unreachable,
 * we want to fall back to the env default in well under a second, not to hang
 * the whole HTTP request waiting for ioredis to reconnect.
 */
const REDIS_LOOKUP_TIMEOUT_MS = 1500;

type RedisConnection = ReturnType<typeof createAppRedisConnection>;

let redisSingleton: RedisConnection | null = null;

function getRedis(): RedisConnection | null {
	if (redisSingleton) {
		return redisSingleton;
	}
	try {
		redisSingleton = createAppRedisConnection(env.REDIS_URL);
		// Swallow background reconnect errors so they don't crash the process
		// (ioredis emits 'error' on every failed reconnect attempt). Per-call
		// failures are still surfaced via the awaited command rejection.
		redisSingleton.on("error", (error) => {
			console.warn("studio.enhance.redis_connection_error", {
				message: error instanceof Error ? error.message : String(error),
			});
		});
		return redisSingleton;
	} catch (error) {
		console.warn("studio.enhance.redis_connect_failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Resolves with the command result, or rejects on timeout. The wall-clock cap
 * is independent of ioredis' own `commandTimeout`: we treat Redis as a best
 * effort source for admin overrides, so the request must keep moving even if
 * the client is in the middle of a reconnect cycle.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Redis lookup timed out after ${ms}ms`));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

async function readProviderFromRedis(): Promise<"grok" | "openrouter" | null> {
	const redis = getRedis();
	if (!redis) {
		return null;
	}
	try {
		const value = await withTimeout(
			redis.get(REDIS_KEY_PROVIDER),
			REDIS_LOOKUP_TIMEOUT_MS
		);
		if (value === "openrouter" || value === "grok") {
			return value;
		}
	} catch (error) {
		console.warn("studio.enhance.redis_provider_lookup_failed", {
			message: error instanceof Error ? error.message : String(error),
		});
	}
	return null;
}

async function readOpenRouterModelFromRedis(): Promise<string | null> {
	const redis = getRedis();
	if (!redis) {
		return null;
	}
	try {
		const value = await withTimeout(
			redis.get(REDIS_KEY_OPENROUTER_MODEL),
			REDIS_LOOKUP_TIMEOUT_MS
		);
		const trimmed = value?.trim();
		return trimmed && trimmed.length > 0 ? trimmed : null;
	} catch (error) {
		console.warn("studio.enhance.redis_model_lookup_failed", {
			message: error instanceof Error ? error.message : String(error),
		});
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
