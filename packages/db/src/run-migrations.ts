import { runMigrations } from "./migrate";

/**
 * CLI-обёртка для прогона миграций. Используется entrypoint-скриптом
 * docker-контейнеров (`docker/entrypoints/run-bun-service.sh`).
 *
 * Сама бизнес-логика лежит в `migrate.ts`, чтобы её можно было
 * импортировать из других модулей (например, `apps/db-migrate`) без
 * побочных эффектов.
 */
await runMigrations();
