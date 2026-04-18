import type { PromptEnhanceProviderName } from "@generator/contracts/admin";
import { createRedisConnection } from "@generator/queue";

type RedisConnection = ReturnType<typeof createRedisConnection>;

const REDIS_KEY = "admin:prompt-enhance-provider";

export interface PromptEnhanceSettings {
	close(): Promise<void>;
	getProvider(): Promise<PromptEnhanceProviderName>;
	setProvider(provider: PromptEnhanceProviderName): Promise<void>;
}

export interface PromptEnhanceSettingsOptions {
	defaultProvider: PromptEnhanceProviderName;
	redisUrl: string;
}

function isPromptEnhanceProvider(
	value: string | null
): value is PromptEnhanceProviderName {
	return value === "grok" || value === "openrouter";
}

export function createRedisPromptEnhanceSettings(
	options: PromptEnhanceSettingsOptions
): PromptEnhanceSettings {
	const connection: RedisConnection = createRedisConnection(options.redisUrl);

	return {
		async close() {
			await connection.quit();
		},
		async getProvider() {
			try {
				const value = await connection.get(REDIS_KEY);
				return isPromptEnhanceProvider(value) ? value : options.defaultProvider;
			} catch {
				return options.defaultProvider;
			}
		},
		async setProvider(provider) {
			await connection.set(REDIS_KEY, provider);
		},
	};
}

export function createInMemoryPromptEnhanceSettings(
	defaultProvider: PromptEnhanceProviderName
): PromptEnhanceSettings {
	let current: PromptEnhanceProviderName = defaultProvider;
	return {
		close() {
			return Promise.resolve();
		},
		getProvider() {
			return Promise.resolve(current);
		},
		setProvider(provider) {
			current = provider;
			return Promise.resolve();
		},
	};
}
