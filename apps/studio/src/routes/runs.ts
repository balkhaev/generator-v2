import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { StudioService } from "@/domain/studio";
import { toErrorResponse } from "@/routes/utils";

const SSE_HEARTBEAT_INTERVAL_MS = 25_000;
const SSE_DEFAULT_ACTIVE_LIMIT = 50;

export function createRunRoutes(service: StudioService) {
	const app = new Hono<{
		Variables: {
			debugCorrelationId: string;
		};
	}>();

	app.get("/", async (c) => {
		const onlyActive = c.req.query("active");
		if (onlyActive === "1" || onlyActive === "true") {
			return c.json({ runs: await service.listActiveWireRuns() });
		}
		return c.json({ runs: await service.listRuns() });
	});

	/**
	 * SSE-стрим run-обновлений. Каждый клиент получает:
	 *   1. `event: snapshot` — массив активных runs в момент подключения,
	 *      чтобы не было гонки с Kafka-эвентами, прилетевшими между HTTP-запросом
	 *      снапшота и установлением SSE-соединения.
	 *   2. `event: run` — отдельный StudioRunWireRecord на каждое обновление
	 *      (приходит от RunUpdatesEmitter, который пинают мутации service'а
	 *      и Kafka consumer этого web-instance).
	 *   3. `event: ping` — heartbeat каждые 25 секунд: проксиs/балансеры
	 *      обычно режут idle-соединения после 60s, а EventSource в браузере
	 *      переподключится на close.
	 */
	app.get("/stream", (c) =>
		streamSSE(c, async (stream) => {
			const initial = await service.listActiveWireRuns(
				SSE_DEFAULT_ACTIVE_LIMIT
			);
			await stream.writeSSE({
				data: JSON.stringify({ runs: initial }),
				event: "snapshot",
			});

			const unsubscribe = service.runUpdatesEmitter.subscribe((record) => {
				stream
					.writeSSE({
						data: JSON.stringify(record),
						event: "run",
					})
					.catch(() => {
						// Поток мог уже закрыться; следующий heartbeat корректно отвалится.
					});
			});

			const heartbeat = setInterval(() => {
				stream.writeSSE({ data: "", event: "ping" }).catch(() => undefined);
			}, SSE_HEARTBEAT_INTERVAL_MS);

			const cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
			};

			c.req.raw.signal.addEventListener("abort", cleanup, { once: true });
			stream.onAbort(cleanup);

			// Держим стрим открытым, пока клиент не отключится.
			await new Promise<void>((resolve) => {
				c.req.raw.signal.addEventListener("abort", () => resolve(), {
					once: true,
				});
			});
		})
	);

	app.get("/:runId/debug", async (c) => {
		try {
			const bundle = await service.getRunDebugBundle(c.req.param("runId"), {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return bundle ? c.json(bundle) : c.json({ error: "Run not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	app.post("/", async (c) => {
		try {
			const payload = await c.req.json();
			const run = await service.launchRun(payload, {
				cookieHeader: c.req.header("cookie") ?? "",
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return c.json({ run }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	app.get("/:runId", async (c) => {
		const run = await service.getRunById(c.req.param("runId"));
		return run ? c.json({ run }) : c.json({ error: "Run not found" }, 404);
	});

	app.post("/:runId/sync", async (c) => {
		try {
			const run = await service.syncRun(c.req.param("runId"), {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return run ? c.json({ run }) : c.json({ error: "Run not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status);
		}
	});

	return app;
}
