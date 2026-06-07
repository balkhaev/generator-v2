/**
 * Контракты внешних интеграций persons-сервиса.
 *
 * Источник правды для shape'ов, которые потребляются и persons-роутами, и
 * внешними клиентами (например `ai-girl`/Adorely). Держим типы здесь, чтобы
 * клиент и сервер не дрейфовали независимо.
 */

/** Режим запуска Adorely-импорта. `preview` — dry-run без записи. */
export type AdorelyImportMode =
	| "import"
	| "import-and-start-training"
	| "preview";

export interface AdorelyImportInput {
	mode: AdorelyImportMode;
	targetDatasetCount?: number;
}

/** Результат импорта одного companion'а из Adorely. */
export interface ImportAdorelyCompanionResult {
	companionId: string;
	importedDatasetPhotoCount: number;
	missingDatasetPhotoCount: number;
	name: string;
	personId: string | null;
	skipped: boolean;
	skipReason: string | null;
	startedTraining: boolean;
}

/** Агрегированный итог по всему прогону импорта. */
export interface ImportAdorelyCompanionsSummary {
	created: number;
	dryRun: boolean;
	failed: number;
	imported: number;
	results: ImportAdorelyCompanionResult[];
	skipped: number;
	startedTraining: number;
	total: number;
	updated: number;
}

/** Фильтр, по которому отбирались companions для импорта. */
export interface AdorelyImportFilter {
	riskLevel: number;
	status: string;
}

/** Тело ответа `POST /api/integrations/adorely-import`. */
export interface AdorelyImportResponse {
	filter: AdorelyImportFilter;
	summary: ImportAdorelyCompanionsSummary;
}
