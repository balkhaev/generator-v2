import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_INTERVAL_MS = 2000;
const DEFAULT_MIGRATION_LOCK_ID = 48_612_451;

export interface RunMigrationsResult {
	completedAt: Date;
	durationMs: number;
}

function getRequiredEnv(name: string) {
	const value = process.env[name]?.trim();

	if (!value) {
		throw new Error(`${name} is required`);
	}

	return value;
}

function getNumberEnv(name: string, fallback: number) {
	const rawValue = process.env[name]?.trim();
	if (!rawValue) {
		return fallback;
	}

	const parsed = Number(rawValue);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive number`);
	}

	return parsed;
}

function redactDatabaseUrl(connectionString: string) {
	const parsedUrl = new URL(connectionString);
	if (parsedUrl.password) {
		parsedUrl.password = "***";
	}

	return parsedUrl.toString();
}

async function waitForDatabase(
	pool: Pool,
	timeoutMs: number,
	retryIntervalMs: number
) {
	const startedAt = Date.now();
	let lastError: unknown = null;

	while (Date.now() - startedAt < timeoutMs) {
		try {
			await pool.query("select 1");
			return;
		} catch (error) {
			lastError = error;
			console.info("[db:migrate] database is not ready yet, retrying", {
				message: error instanceof Error ? error.message : "unknown",
			});
			await sleep(retryIntervalMs);
		}
	}

	throw new Error(
		`Database did not become ready within ${timeoutMs}ms${
			lastError instanceof Error ? `: ${lastError.message}` : ""
		}`
	);
}

/**
 * Применяет все pending Drizzle-миграции под защитой Postgres advisory lock.
 * Безопасно вызывать параллельно: второй вызывающий дождётся освобождения.
 *
 * Единственный потребитель — long-running сервис `apps/db-migrate`, который
 * прогоняет миграции на старте и предоставляет `POST /api/migrate` для
 * повторного запуска без редеплоя. Бэкенд-сервисы (admin/studio/...) больше
 * НЕ запускают миграции на старте — см. docker/entrypoints/run-bun-service.sh.
 */
export async function runMigrations(): Promise<RunMigrationsResult> {
	const databaseUrl = getRequiredEnv("DATABASE_URL");
	const readyTimeoutMs = getNumberEnv(
		"DATABASE_READY_TIMEOUT_MS",
		DEFAULT_READY_TIMEOUT_MS
	);
	const retryIntervalMs = getNumberEnv(
		"DATABASE_READY_INTERVAL_MS",
		DEFAULT_RETRY_INTERVAL_MS
	);
	const migrationLockId = getNumberEnv(
		"DATABASE_MIGRATION_LOCK_ID",
		DEFAULT_MIGRATION_LOCK_ID
	);
	// Бандлеры (tsdown) ломают import.meta.url, поэтому db-migrate
	// передаёт `DATABASE_MIGRATIONS_FOLDER=/app/packages/db/src/migrations`
	// явно. Fallback на путь рядом с файлом нужен только для запуска
	// raw-TS из `packages/db/src` локально (drizzle-kit / dev-инструменты).
	const migrationsFolder =
		process.env.DATABASE_MIGRATIONS_FOLDER?.trim() ||
		fileURLToPath(new URL("./migrations", import.meta.url));
	const startedAt = Date.now();

	console.info("[db:migrate] waiting for database", {
		databaseUrl: redactDatabaseUrl(databaseUrl),
		migrationsFolder,
	});

	const pool = new Pool({
		connectionString: databaseUrl,
		max: 1,
		idleTimeoutMillis: 5000,
		connectionTimeoutMillis: retryIntervalMs,
	});

	try {
		await waitForDatabase(pool, readyTimeoutMs, retryIntervalMs);

		const client = await pool.connect();
		try {
			console.info("[db:migrate] acquiring advisory lock", {
				lockId: migrationLockId,
			});
			await client.query("select pg_advisory_lock($1)", [migrationLockId]);
			console.info("[db:migrate] applying migrations");
			await migrate(drizzle(client), {
				migrationsFolder,
			});
			console.info("[db:migrate] migrations completed");
		} finally {
			try {
				await client.query("select pg_advisory_unlock($1)", [migrationLockId]);
			} finally {
				client.release();
			}
		}
	} finally {
		await pool.end();
	}

	const completedAt = new Date();
	return {
		completedAt,
		durationMs: completedAt.getTime() - startedAt,
	};
}
