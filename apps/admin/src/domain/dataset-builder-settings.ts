/**
 * Runtime-настройки dataset-builder-а: какая fal.ai edit-модель используется
 * для генерации синтетических вариаций референса при подготовке LoRA-датасета.
 *
 * Источник истины — Redis, чтобы UI мог менять модель без рестарта воркера.
 * Если в Redis ничего не сохранено или значение не из allow-list — возвращаем
 * `DEFAULT_DATASET_EDITOR_MODEL_ID`. Воркер вызывает `getEditorModelId()`
 * перед каждым job-ом, поэтому переключение применяется к новым job-ам сразу.
 *
 * Форма аналогична `training-provider-settings.ts` — это сознательный выбор,
 * чтобы реструктура admin-snapshot-а была однообразной.
 */

import { createRedisConnection } from "@generator/queue";
import {
	DEFAULT_DATASET_EDITOR_MODEL_ID,
	isKnownDatasetEditorModelId,
} from "@/providers/dataset-editor-models";

type RedisConnection = ReturnType<typeof createRedisConnection>;

const REDIS_KEY = "admin:dataset-builder-editor-model";

export interface DatasetBuilderSettings {
	close(): Promise<void>;
	getEditorModelId(): Promise<string>;
	setEditorModelId(modelId: string): Promise<void>;
}

export interface DatasetBuilderSettingsOptions {
	redisUrl: string;
}

export function createRedisDatasetBuilderSettings(
	options: DatasetBuilderSettingsOptions
): DatasetBuilderSettings {
	const connection: RedisConnection = createRedisConnection(options.redisUrl);

	return {
		async getEditorModelId() {
			try {
				const value = await connection.get(REDIS_KEY);
				return isKnownDatasetEditorModelId(value)
					? value
					: DEFAULT_DATASET_EDITOR_MODEL_ID;
			} catch {
				return DEFAULT_DATASET_EDITOR_MODEL_ID;
			}
		},
		async setEditorModelId(modelId) {
			if (!isKnownDatasetEditorModelId(modelId)) {
				throw new Error(`Unknown dataset editor model id: ${modelId}`);
			}
			await connection.set(REDIS_KEY, modelId);
		},
		async close() {
			await connection.quit();
		},
	};
}

/**
 * In-memory fallback для тестов и dev-окружений без Redis.
 */
export function createInMemoryDatasetBuilderSettings(
	defaultModelId: string = DEFAULT_DATASET_EDITOR_MODEL_ID
): DatasetBuilderSettings {
	let current = isKnownDatasetEditorModelId(defaultModelId)
		? defaultModelId
		: DEFAULT_DATASET_EDITOR_MODEL_ID;
	return {
		getEditorModelId() {
			return Promise.resolve(current);
		},
		setEditorModelId(modelId) {
			if (!isKnownDatasetEditorModelId(modelId)) {
				return Promise.reject(
					new Error(`Unknown dataset editor model id: ${modelId}`)
				);
			}
			current = modelId;
			return Promise.resolve();
		},
		close() {
			return Promise.resolve();
		},
	};
}
