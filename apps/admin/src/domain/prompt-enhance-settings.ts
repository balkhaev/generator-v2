import type {
	PromptEnhanceProviderName,
	PromptEnhanceTarget,
} from "@generator/contracts/admin";
import { createRedisConnection } from "@generator/queue";

type RedisConnection = ReturnType<typeof createRedisConnection>;

const REDIS_KEY_PREFIXES: Record<PromptEnhanceTarget, string> = {
	persons: "admin:prompt-enhance-persons",
	studio: "admin:prompt-enhance-studio",
};

const REDIS_KEY_PROVIDER = (target: PromptEnhanceTarget) =>
	`${REDIS_KEY_PREFIXES[target]}-provider`;
const REDIS_KEY_OPENROUTER_MODEL = (target: PromptEnhanceTarget) =>
	`${REDIS_KEY_PREFIXES[target]}-openrouter-model`;

/**
 * Per-target prompt-enhance settings store.
 *
 * Two surfaces (`studio` and `persons`) own independent provider + model
 * settings so they can run on different LLMs without the admin UI being
 * forced into a single global toggle. Backed by Redis for read latency,
 * mirrored into runtime-config for distribution to consumer services.
 */
export interface PromptEnhanceSettings {
	close(): Promise<void>;
	getOpenRouterModel(target: PromptEnhanceTarget): Promise<string>;
	getProvider(target: PromptEnhanceTarget): Promise<PromptEnhanceProviderName>;
	setOpenRouterModel(target: PromptEnhanceTarget, model: string): Promise<void>;
	setProvider(
		target: PromptEnhanceTarget,
		provider: PromptEnhanceProviderName
	): Promise<void>;
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
		async getOpenRouterModel(target) {
			try {
				const value = await connection.get(REDIS_KEY_OPENROUTER_MODEL(target));
				const trimmed = value?.trim();
				if (trimmed) {
					return trimmed;
				}
			} catch {
				// fall through
			}
			return options.defaultOpenRouterModel;
		},
		async getProvider(target) {
			try {
				const value = await connection.get(REDIS_KEY_PROVIDER(target));
				return isPromptEnhanceProvider(value) ? value : options.defaultProvider;
			} catch {
				return options.defaultProvider;
			}
		},
		async setOpenRouterModel(target, model) {
			await connection.set(REDIS_KEY_OPENROUTER_MODEL(target), model.trim());
		},
		async setProvider(target, provider) {
			await connection.set(REDIS_KEY_PROVIDER(target), provider);
		},
	};
}

export function createInMemoryPromptEnhanceSettings(
	defaultProvider: PromptEnhanceProviderName,
	defaultOpenRouterModel: string
): PromptEnhanceSettings {
	const providers: Record<PromptEnhanceTarget, PromptEnhanceProviderName> = {
		persons: defaultProvider,
		studio: defaultProvider,
	};
	const models: Record<PromptEnhanceTarget, string> = {
		persons: defaultOpenRouterModel,
		studio: defaultOpenRouterModel,
	};
	return {
		close() {
			return Promise.resolve();
		},
		getOpenRouterModel(target) {
			return Promise.resolve(models[target]);
		},
		getProvider(target) {
			return Promise.resolve(providers[target]);
		},
		setOpenRouterModel(target, model) {
			models[target] = model.trim();
			return Promise.resolve();
		},
		setProvider(target, provider) {
			providers[target] = provider;
			return Promise.resolve();
		},
	};
}
