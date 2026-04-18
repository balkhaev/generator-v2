import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { runMigrations } from "@generator/db/migrate";
import { Hono } from "hono";
import { Pool } from "pg";

interface MigrationStatus {
	completedAt: string | null;
	durationMs: number | null;
	error: string | null;
	startedAt: string;
	state: "pending" | "running" | "succeeded" | "failed";
}

const status: MigrationStatus = {
	completedAt: null,
	durationMs: null,
	error: null,
	startedAt: new Date().toISOString(),
	state: "pending",
};

async function performMigrations() {
	status.state = "running";
	status.startedAt = new Date().toISOString();
	status.completedAt = null;
	status.durationMs = null;
	status.error = null;

	try {
		const result = await runMigrations();
		status.state = "succeeded";
		status.completedAt = result.completedAt.toISOString();
		status.durationMs = result.durationMs;
		console.info("[db-migrate] migrations succeeded", {
			completedAt: status.completedAt,
			durationMs: status.durationMs,
		});
	} catch (error) {
		status.state = "failed";
		status.completedAt = new Date().toISOString();
		status.error = error instanceof Error ? error.message : String(error);
		console.error("[db-migrate] migrations failed", {
			error: status.error,
		});
	}
}

const initialRun = performMigrations();

const app = new Hono();

app.get("/", (c) => c.text("db-migrate"));

// Liveness: всегда 200 если процесс жив. Coolify health-check использует
// этот эндпоинт для определения готовности контейнера.
app.get("/api/health", (c) =>
	c.json({
		ok: true,
		service: "db-migrate",
	})
);

// Полный статус последней попытки миграции. 200 при успехе, 503 при текущей
// ошибке. Удобно для ручной диагностики.
app.get("/api/ready", (c) => {
	if (status.state === "succeeded") {
		return c.json({ ok: true, ...status });
	}
	if (status.state === "failed") {
		return c.json({ ok: false, ...status }, 503);
	}
	return c.json({ ok: false, ...status }, 503);
});

app.get("/api/status", (c) => c.json(status));

const triggerToken = process.env.MIGRATE_TRIGGER_TOKEN?.trim();
const BEARER_PREFIX_RE = /^Bearer\s+/iu;
const LEADING_SLASH_RE = /^\//u;

function isAuthorized(c: {
	req: { header: (name: string) => string | undefined };
}) {
	if (!triggerToken) {
		return true;
	}
	const header = c.req.header("authorization") ?? "";
	const provided = header.replace(BEARER_PREFIX_RE, "");
	return provided === triggerToken;
}

function getMigrationsFolder() {
	return (
		process.env.DATABASE_MIGRATIONS_FOLDER?.trim() ||
		"/app/packages/db/src/migrations"
	);
}

interface JournalEntry {
	idx: number;
	tag: string;
	when: number;
}

interface JournalFile {
	entries: JournalEntry[];
}

// Полная пересинхронизация drizzle.__drizzle_migrations с _journal.json:
// для каждой записи журнала читаем соответствующий .sql файл, считаем
// sha256 (так же как делает сам drizzle migrator), внутри одной транзакции
// очищаем таблицу и переинсертим строки с правильными `hash` и
// `created_at = when`. После этого drizzle на следующем запуске видит, что
// все миграции уже применены, и ничего не делает — а будущие миграции с
// нормальным `when` (≈ `Date.now()`) применяются нативно, без хаков.
//
// Используется один раз для починки окружения, в которое drizzle тихо
// «применил» меньше миграций, чем должен был (например, из-за раздутого
// `when` у промежуточной миграции). Защищён MIGRATE_TRIGGER_TOKEN.
app.post("/api/resync-journal", async (c) => {
	if (!isAuthorized(c)) {
		return c.json({ error: "unauthorized" }, 401);
	}
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		return c.json({ error: "DATABASE_URL is not set" }, 500);
	}

	const migrationsFolder = getMigrationsFolder();
	let entries: JournalEntry[];
	let rows: { tag: string; hash: string; created_at: number }[];
	try {
		const journalRaw = await readFile(
			join(migrationsFolder, "meta", "_journal.json"),
			"utf8"
		);
		const parsed = JSON.parse(journalRaw) as JournalFile;
		entries = parsed.entries.slice().sort((a, b) => a.when - b.when);
		rows = await Promise.all(
			entries.map(async (entry) => {
				const sql = await readFile(
					join(migrationsFolder, `${entry.tag}.sql`),
					"utf8"
				);
				return {
					tag: entry.tag,
					hash: createHash("sha256").update(sql).digest("hex"),
					created_at: entry.when,
				};
			})
		);
	} catch (error) {
		return c.json(
			{
				error: `failed to read journal: ${error instanceof Error ? error.message : String(error)}`,
			},
			500
		);
	}

	if (status.state === "running") {
		return c.json(
			{ error: "migrations are already running, retry later", status },
			409
		);
	}

	const pool = new Pool({
		connectionString: databaseUrl,
		max: 1,
		connectionTimeoutMillis: 5000,
		idleTimeoutMillis: 1000,
	});
	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query("create schema if not exists drizzle");
		await client.query(
			`create table if not exists drizzle.__drizzle_migrations (
				id serial primary key,
				hash text not null,
				created_at bigint
			)`
		);
		await client.query("truncate drizzle.__drizzle_migrations");
		for (const row of rows) {
			await client.query(
				"insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
				[row.hash, row.created_at]
			);
		}
		await client.query("commit");
	} catch (error) {
		await client.query("rollback").catch((rollbackError) => {
			console.error("[db-migrate] resync rollback failed", { rollbackError });
		});
		client.release();
		await pool.end();
		return c.json(
			{ error: error instanceof Error ? error.message : String(error) },
			500
		);
	}
	client.release();
	await pool.end();

	return c.json({ resynced: rows });
});

// Удалить N последних записей из drizzle.__drizzle_migrations и
// перезапустить миграции. Нужен в редких случаях, когда journal.json
// содержит записи с `when` меньше последнего применённого `created_at`,
// и drizzle migrator из-за этого молча пропускает свежие миграции.
// После удаления последних N записей drizzle переприменит соответствующие
// миграции (поэтому они должны быть идемпотентными или ещё не применёнными).
// Защищён MIGRATE_TRIGGER_TOKEN.
app.post("/api/repair-journal", async (c) => {
	if (!isAuthorized(c)) {
		return c.json({ error: "unauthorized" }, 401);
	}
	const body = (await c.req.json().catch(() => ({}))) as {
		drop_last_n?: number;
	};
	const dropLastN = Math.max(
		1,
		Math.min(10, Math.floor(Number(body.drop_last_n ?? 1)))
	);
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		return c.json({ error: "DATABASE_URL is not set" }, 500);
	}
	const pool = new Pool({
		connectionString: databaseUrl,
		max: 1,
		connectionTimeoutMillis: 5000,
		idleTimeoutMillis: 1000,
	});
	let removed: { hash: string; created_at: string }[] = [];
	try {
		const result = await pool.query<{ hash: string; created_at: string }>(
			`delete from drizzle.__drizzle_migrations
			 where id in (
				 select id from drizzle.__drizzle_migrations
				 order by created_at desc
				 limit $1
			 )
			 returning hash, created_at::text`,
			[dropLastN]
		);
		removed = result.rows;
	} catch (error) {
		await pool.end();
		return c.json(
			{ error: error instanceof Error ? error.message : String(error) },
			500
		);
	}
	await pool.end();
	if (status.state === "running") {
		return c.json(
			{ error: "migrations are already running, retry later", removed, status },
			409
		);
	}
	performMigrations().catch(() => {
		// Ошибка уже залогирована и сохранена в status.
	});
	return c.json({ accepted: true, removed, status }, 202);
});

// Диагностический snapshot текущего состояния БД с точки зрения этого
// контейнера: какая host:port:db, какие миграции зарегистрированы в
// drizzle.__drizzle_migrations, какие колонки реально есть в studio_run.
// Защищён тем же `MIGRATE_TRIGGER_TOKEN`, чтобы не светить наружу.
app.get("/api/db-info", async (c) => {
	if (!isAuthorized(c)) {
		return c.json({ error: "unauthorized" }, 401);
	}
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		return c.json({ error: "DATABASE_URL is not set" }, 500);
	}
	const pool = new Pool({
		connectionString: databaseUrl,
		max: 1,
		connectionTimeoutMillis: 5000,
		idleTimeoutMillis: 1000,
	});
	try {
		const url = new URL(databaseUrl);
		const conn = await pool.query<{
			db: string;
			host: string;
			user: string;
			port: number;
		}>(
			"select current_database() as db, inet_server_addr()::text as host, current_user as user, inet_server_port() as port"
		);
		const migrations = await pool.query<{ hash: string; created_at: string }>(
			"select hash, created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 30"
		);
		const studioRunCols = await pool.query<{
			column_name: string;
			data_type: string;
		}>(
			"select column_name, data_type from information_schema.columns where table_schema='public' and table_name='studio_run' order by ordinal_position"
		);
		return c.json({
			database_url_host: `${url.hostname}:${url.port || 5432}/${url.pathname.replace(LEADING_SLASH_RE, "")}`,
			server: conn.rows[0],
			migrations_journal_count: migrations.rowCount,
			migrations_journal: migrations.rows,
			studio_run_columns: studioRunCols.rows,
		});
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : String(error) },
			500
		);
	} finally {
		await pool.end();
	}
});

// Триггер повторного прогона миграций без редеплоя контейнера. Защищён
// bearer-токеном `MIGRATE_TRIGGER_TOKEN`, если он задан.
app.post("/api/migrate", (c) => {
	if (!isAuthorized(c)) {
		return c.json({ error: "unauthorized" }, 401);
	}
	if (status.state === "running") {
		return c.json({ error: "migrations are already running", status }, 409);
	}
	performMigrations().catch(() => {
		// Ошибка уже залогирована и сохранена в status.
	});
	return c.json({ accepted: true, status }, 202);
});

initialRun.catch(() => {
	// Ошибка уже залогирована и отражена в `status`. Сервер должен
	// продолжать работать, чтобы Coolify увидел healthy-контейнер и логи
	// были доступны для разбора.
});

export default {
	port: Number(process.env.PORT ?? 3010),
	fetch: app.fetch,
};
