import type {
	RunpodServerlessApi,
	ServerlessEndpointHealth,
} from "../api/serverless";
import type { ServerlessWorkflow } from "../workflow/definition";

const DEFAULT_INTERVAL_MS = 4 * 60 * 1000;
const DEFAULT_WAIT_MS = 15_000;
const MIN_INTERVAL_MS = 30_000;

export interface ServerlessWarmupOptions<TInput, TOutput> {
	api: RunpodServerlessApi;
	/** Базовый интервал между warm-up циклами (мс). Default 4 минуты. */
	intervalMs?: number;
	logger?: Pick<Console, "info" | "warn" | "error">;
	/**
	 * Hook вызывается на каждом цикле — полезно для metric'ов: idle/throttled
	 * worker count, queue depth, время прогона warm-ping.
	 */
	observer?: ServerlessWarmupObserver;
	/** Пользовательский setTimeout — для тестов. */
	scheduler?: WarmupScheduler;
	workflow: ServerlessWorkflow<TInput, TOutput>;
}

export interface ServerlessWarmupObserver {
	onCycle?(event: ServerlessWarmupEvent): void;
	onError?(event: { error: Error; phase: "health" | "ping" }): void;
}

export interface ServerlessWarmupEvent {
	durationMs: number;
	health: ServerlessEndpointHealth;
	pinged: boolean;
	rawStatus: string | null;
	skippedReason: "warm-workers-available" | "health-error" | null;
}

export interface ServerlessWarmupRunner {
	/**
	 * Одиночный warm-up цикл — синхронно: snapshot health, опционально отправить
	 * /runsync ping, вернуть итог. Полезно использовать в CLI или из cron.
	 */
	runOnce(): Promise<ServerlessWarmupEvent>;
	/** Запустить периодический warm-up. Можно вызывать только один раз. */
	start(): void;
	/** Остановить периодический warm-up и дождаться текущего цикла. */
	stop(): Promise<void>;
}

export interface WarmupScheduler {
	clearTimeout(handle: WarmupHandle): void;
	setTimeout(callback: () => void, ms: number): WarmupHandle;
}

export type WarmupHandle = unknown;

/**
 * RunPod serverless по умолчанию засыпает за 5 секунд после ответа. Можно
 * включить `active workers ≥ 1` в console (надёжно, но дорого — посекундная
 * тарификация worker'а 24/7), а можно держать "ленивого" warm-up'а: каждые
 * N минут отправлять `/runsync` с тривиальным input'ом — это держит хотя бы
 * один worker idle во FlashBoot'е, и cold-start первого реального запроса
 * заменяется на FlashBoot (≈ 1-3s вместо 30-60s).
 *
 * Логика цикла:
 *
 * 1. Снять `/health` snapshot.
 * 2. Если `workflow.warmup.skipWhenWarmersAvailable !== false` и есть
 *    idle/initializing/ready worker — пропустить ping (не платим за лишний
 *    job).
 * 3. Иначе отправить `/runsync` с `workflow.warmup.buildInput()` payload'ом,
 *    `policy.lowPriority = true` чтобы не триггерить scale-out, и
 *    `executionTimeout` маленький.
 */
export function createServerlessWarmupRunner<TInput, TOutput>(
	options: ServerlessWarmupOptions<TInput, TOutput>
): ServerlessWarmupRunner {
	const { api, logger, observer, workflow } = options;
	const warmup = workflow.warmup;
	if (!warmup) {
		throw new Error(
			`Workflow ${workflow.id} does not declare a warmup payload; pass workflow.warmup or skip the warmup runner`
		);
	}
	const intervalMs = Math.max(
		MIN_INTERVAL_MS,
		options.intervalMs ?? DEFAULT_INTERVAL_MS
	);
	const waitMs = warmup.waitMs ?? DEFAULT_WAIT_MS;
	const skipWhenWarm = warmup.skipWhenWarmersAvailable ?? true;
	const scheduler = options.scheduler ?? defaultScheduler;

	let handle: WarmupHandle | null = null;
	let started = false;
	let stopped = false;
	let activeCycle: Promise<unknown> | null = null;

	const cycle = async (): Promise<ServerlessWarmupEvent> => {
		const startedAt = Date.now();
		let health: ServerlessEndpointHealth;
		try {
			health = await api.getHealth({ endpointId: workflow.endpointId });
		} catch (error) {
			const wrapped = error instanceof Error ? error : new Error(String(error));
			observer?.onError?.({ error: wrapped, phase: "health" });
			logger?.warn?.("runpod-serverless.warmup.health-failed", {
				endpointId: workflow.endpointId,
				message: wrapped.message,
				workflowId: workflow.id,
			});
			const event: ServerlessWarmupEvent = {
				durationMs: Date.now() - startedAt,
				health: emptyHealth(),
				pinged: false,
				rawStatus: null,
				skippedReason: "health-error",
			};
			observer?.onCycle?.(event);
			return event;
		}

		const warmWorkers =
			health.workers.idle + health.workers.initializing + health.workers.ready;
		if (skipWhenWarm && warmWorkers > 0) {
			const event: ServerlessWarmupEvent = {
				durationMs: Date.now() - startedAt,
				health,
				pinged: false,
				rawStatus: null,
				skippedReason: "warm-workers-available",
			};
			observer?.onCycle?.(event);
			return event;
		}

		const input = warmup.buildInput();
		const parsed = workflow.inputSchema.parse(input);
		const payload = workflow.buildPayload(parsed);
		try {
			const submission = await api.runSync({
				endpointId: workflow.endpointId,
				input: payload,
				policy: {
					executionTimeout: warmup.policy?.executionTimeout ?? 60_000,
					lowPriority: warmup.policy?.lowPriority ?? true,
					ttl: warmup.policy?.ttl ?? 5 * 60_000,
				} as unknown as Record<string, unknown>,
				waitMs,
			});
			logger?.info?.("runpod-serverless.warmup.pinged", {
				endpointId: workflow.endpointId,
				jobId: submission.jobId,
				rawStatus: submission.rawStatus,
				workflowId: workflow.id,
			});
			const event: ServerlessWarmupEvent = {
				durationMs: Date.now() - startedAt,
				health,
				pinged: true,
				rawStatus: submission.rawStatus,
				skippedReason: null,
			};
			observer?.onCycle?.(event);
			return event;
		} catch (error) {
			const wrapped = error instanceof Error ? error : new Error(String(error));
			observer?.onError?.({ error: wrapped, phase: "ping" });
			logger?.warn?.("runpod-serverless.warmup.ping-failed", {
				endpointId: workflow.endpointId,
				message: wrapped.message,
				workflowId: workflow.id,
			});
			const event: ServerlessWarmupEvent = {
				durationMs: Date.now() - startedAt,
				health,
				pinged: false,
				rawStatus: null,
				skippedReason: null,
			};
			observer?.onCycle?.(event);
			return event;
		}
	};

	const scheduleNext = (): void => {
		if (stopped || !started) {
			return;
		}
		handle = scheduler.setTimeout(() => {
			handle = null;
			runCycle().catch((error) => {
				logger?.error?.("runpod-serverless.warmup.cycle-crashed", {
					endpointId: workflow.endpointId,
					message: error instanceof Error ? error.message : String(error),
					workflowId: workflow.id,
				});
			});
		}, intervalMs);
	};

	const runCycle = async (): Promise<void> => {
		if (stopped) {
			return;
		}
		const promise = cycle();
		activeCycle = promise;
		try {
			await promise;
		} finally {
			activeCycle = null;
			scheduleNext();
		}
	};

	return {
		runOnce: cycle,
		start() {
			if (started) {
				return;
			}
			started = true;
			stopped = false;
			scheduleNext();
		},
		async stop() {
			stopped = true;
			started = false;
			if (handle !== null) {
				scheduler.clearTimeout(handle);
				handle = null;
			}
			if (activeCycle) {
				await activeCycle.catch(() => {
					// already logged via observer.onError
				});
			}
		},
	};
}

const defaultScheduler: WarmupScheduler = {
	clearTimeout(handle) {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	},
	setTimeout(callback, ms) {
		return setTimeout(callback, ms);
	},
};

function emptyHealth(): ServerlessEndpointHealth {
	return {
		jobs: {
			completed: 0,
			failed: 0,
			inProgress: 0,
			inQueue: 0,
			retried: 0,
		},
		workers: {
			idle: 0,
			initializing: 0,
			ready: 0,
			running: 0,
			throttled: 0,
			unhealthy: 0,
		},
	};
}
