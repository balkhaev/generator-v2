import { sql } from "drizzle-orm";

import { db } from "./index";

/**
 * Лёгкая проверка живости подключения к БД для readiness-эндпоинтов.
 * Не делает SELECT по реальным таблицам, чтобы пинг не падал из-за
 * несоответствия схемы во время прокатки миграций.
 */
export async function pingDatabase(): Promise<void> {
	await db.execute(sql`select 1`);
}
