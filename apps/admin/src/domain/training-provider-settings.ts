/**
 * Runtime-настройки выбора LoRA-training провайдера. Источник истины — Redis,
 * чтобы UI-свитчер из admin-web мог менять провайдер без перезапуска воркера и
 * без миграций БД (это эксперимент).
 *
 * Контракт:
 *   - Если в Redis ничего не сохранено → возвращаем дефолт из env
 *     (`TRAINING_PROVIDER`).
 *   - Если RUNPOD креды не настроены, выставить `runpod` через API нельзя
 *     (валидация в маршруте `/api/admin/training-provider`).
 *   - Воркер читает значение перед каждым job-ом, поэтому переключение
 *     применяется к новым задачам сразу. Уже выполняющиеся job-ы дорабатываются
 *     на старом провайдере.
 */

import { createRedisConnection } from "@generator/queue";

type RedisConnection = ReturnType<typeof createRedisConnection>;

export type TrainingProviderName = "runpod";

export const TRAINING_PROVIDER_NAMES = [
	"runpod",
] as const satisfies readonly TrainingProviderName[];

const REDIS_KEY = "admin:training-provider";

export interface TrainingProviderSettings {
	close(): Promise<void>;
	getProvider(): Promise<TrainingProviderName>;
	setProvider(provider: TrainingProviderName): Promise<void>;
}

export interface TrainingProviderSettingsOptions {
	defaultProvider: TrainingProviderName;
	redisUrl: string;
}

function isTrainingProvider(
	value: string | null
): value is TrainingProviderName {
	return value === "runpod";
}

export function createRedisTrainingProviderSettings(
	options: TrainingProviderSettingsOptions
): TrainingProviderSettings {
	const connection: RedisConnection = createRedisConnection(options.redisUrl);

	return {
		async getProvider() {
			try {
				const value = await connection.get(REDIS_KEY);
				return isTrainingProvider(value) ? value : options.defaultProvider;
			} catch {
				return options.defaultProvider;
			}
		},
		async setProvider(provider) {
			await connection.set(REDIS_KEY, provider);
		},
		async close() {
			await connection.quit();
		},
	};
}

/**
 * In-memory implementation для тестов и dev-окружений без Redis.
 */
export function createInMemoryTrainingProviderSettings(
	defaultProvider: TrainingProviderName
): TrainingProviderSettings {
	let current: TrainingProviderName = defaultProvider;
	return {
		getProvider() {
			return Promise.resolve(current);
		},
		setProvider(provider) {
			current = provider;
			return Promise.resolve();
		},
		close() {
			return Promise.resolve();
		},
	};
}
