import { runMigrations } from "@generator/db/migrate";
import { Hono } from "hono";

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

// Триггер повторного прогона миграций без редеплоя контейнера. Защищён
// bearer-токеном `MIGRATE_TRIGGER_TOKEN`, если он задан.
const triggerToken = process.env.MIGRATE_TRIGGER_TOKEN?.trim();
const BEARER_PREFIX_RE = /^Bearer\s+/iu;
app.post("/api/migrate", (c) => {
	if (triggerToken) {
		const header = c.req.header("authorization") ?? "";
		const provided = header.replace(BEARER_PREFIX_RE, "");
		if (provided !== triggerToken) {
			return c.json({ error: "unauthorized" }, 401);
		}
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
