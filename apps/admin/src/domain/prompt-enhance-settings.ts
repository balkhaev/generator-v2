import type { PromptEnhanceProviderName } from "@generator/contracts/admin";
import { createRedisConnection } from "@generator/queue";

type RedisConnection = ReturnType<typeof createRedisConnection>;

const REDIS_KEY_PROVIDER = "admin:prompt-enhance-provider";
const REDIS_KEY_OPENROUTER_MODEL = "admin:prompt-enhance-openrouter-model";

export interface PromptEnhanceSettings {
	close(): Promise<void>;
	getOpenRouterModel(): Promise<string>;
	getProvider(): Promise<PromptEnhanceProviderName>;
	setOpenRouterModel(model: string): Promise<void>;
	setProvider(provider: PromptEnhanceProviderName): Promise<void>;
}

export interface PromptEnhanceSettingsOptions {
	defaultOpenRouterModel: string;
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
		async getOpenRouterModel() {
			try {
				const value = await connection.get(REDIS_KEY_OPENROUTER_MODEL);
				const trimmed = value?.trim();
				if (trimmed) {
					return trimmed;
				}
			} catch {
				// fall through
			}
			return options.defaultOpenRouterModel;
		},
		async getProvider() {
			try {
				const value = await connection.get(REDIS_KEY_PROVIDER);
				return isPromptEnhanceProvider(value) ? value : options.defaultProvider;
			} catch {
				return options.defaultProvider;
			}
		},
		async setOpenRouterModel(model) {
			await connection.set(REDIS_KEY_OPENROUTER_MODEL, model.trim());
		},
		async setProvider(provider) {
			await connection.set(REDIS_KEY_PROVIDER, provider);
		},
	};
}

export function createInMemoryPromptEnhanceSettings(
	defaultProvider: PromptEnhanceProviderName,
	defaultOpenRouterModel: string
): PromptEnhanceSettings {
	let currentProvider: PromptEnhanceProviderName = defaultProvider;
	let currentOpenRouterModel = defaultOpenRouterModel;
	return {
		close() {
			return Promise.resolve();
		},
		getOpenRouterModel() {
			return Promise.resolve(currentOpenRouterModel);
		},
		getProvider() {
			return Promise.resolve(currentProvider);
		},
		setOpenRouterModel(model) {
			currentOpenRouterModel = model.trim();
			return Promise.resolve();
		},
		setProvider(provider) {
			currentProvider = provider;
			return Promise.resolve();
		},
	};
}
