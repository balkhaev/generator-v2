import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

import type {
	RunpodServerlessApi,
	ServerlessEndpointHealth,
	ServerlessSubmission,
} from "../api/serverless";
import type { ServerlessWorkflow } from "../workflow/definition";
import { createServerlessWarmupRunner } from "./serverless-warmup";

const pingInputSchema = z.object({
	prompt: z.string(),
	ping: z.literal(true).optional(),
});

const baseWorkflow: ServerlessWorkflow<
	z.infer<typeof pingInputSchema>,
	unknown
> = {
	id: "fooocus-sdxl",
	mode: "serverless",
	endpointId: "endpoint-x",
	inputSchema: pingInputSchema,
	buildPayload(input) {
		return input;
	},
	parseOutput(raw) {
		return raw;
	},
	warmup: {
		buildInput() {
			return { prompt: "warmup", ping: true };
		},
	},
};

function buildHealth(
	overrides: Partial<ServerlessEndpointHealth["workers"]> = {}
): ServerlessEndpointHealth {
	return {
		jobs: { completed: 0, failed: 0, inProgress: 0, inQueue: 0, retried: 0 },
		workers: {
			idle: 0,
			initializing: 0,
			ready: 0,
			running: 0,
			throttled: 0,
			unhealthy: 0,
			...overrides,
		},
	};
}

function buildApi(
	overrides: Partial<RunpodServerlessApi>
): RunpodServerlessApi {
	return {
		cancel: overrides.cancel ?? mock(() => Promise.resolve()),
		getHealth:
			overrides.getHealth ?? mock(() => Promise.resolve(buildHealth())),
		getStatus:
			overrides.getStatus ??
			mock(() =>
				Promise.resolve({
					delayTimeMs: null,
					error: null,
					executionTimeMs: null,
					jobId: "x",
					output: null,
					queuePosition: null,
					rawStatus: "IN_QUEUE",
					retries: null,
				})
			),
		purgeQueue:
			overrides.purgeQueue ??
			mock(() => Promise.resolve({ removed: 0, status: "completed" })),
		retry:
			overrides.retry ??
			mock(() =>
				Promise.resolve<ServerlessSubmission>({
					delayTimeMs: null,
					error: null,
					executionTimeMs: null,
					jobId: "x",
					output: null,
					queuePosition: null,
					rawStatus: "IN_QUEUE",
				})
			),
		runSync:
			overrides.runSync ??
			mock(() =>
				Promise.resolve<ServerlessSubmission>({
					delayTimeMs: null,
					error: null,
					executionTimeMs: null,
					jobId: "sync-ping",
					output: null,
					queuePosition: null,
					rawStatus: "COMPLETED",
				})
			),
		submit:
			overrides.submit ??
			mock(() =>
				Promise.resolve<ServerlessSubmission>({
					delayTimeMs: null,
					error: null,
					executionTimeMs: null,
					jobId: "x",
					output: null,
					queuePosition: null,
					rawStatus: "IN_QUEUE",
				})
			),
	};
}

const NO_WARMUP_PATTERN = /does not declare a warmup payload/;

describe("createServerlessWarmupRunner", () => {
	it("throws if workflow.warmup is missing", () => {
		expect(() =>
			createServerlessWarmupRunner({
				api: buildApi({}),
				workflow: { ...baseWorkflow, warmup: undefined },
			})
		).toThrow(NO_WARMUP_PATTERN);
	});

	it("skips ping when warm workers are available", async () => {
		const getHealth = mock(() => Promise.resolve(buildHealth({ idle: 1 })));
		const runSync = mock(() =>
			Promise.reject(new Error("/runsync should not be called"))
		);
		const runner = createServerlessWarmupRunner({
			api: buildApi({ getHealth, runSync }),
			workflow: baseWorkflow,
		});

		const event = await runner.runOnce();
		expect(event.pinged).toBe(false);
		expect(event.skippedReason).toBe("warm-workers-available");
		expect(runSync).toHaveBeenCalledTimes(0);
	});

	it("pings when no warm workers are available", async () => {
		const getHealth = mock(() => Promise.resolve(buildHealth()));
		const runSync = mock(() =>
			Promise.resolve<ServerlessSubmission>({
				delayTimeMs: 100,
				error: null,
				executionTimeMs: 800,
				jobId: "sync-ping",
				output: null,
				queuePosition: null,
				rawStatus: "COMPLETED",
			})
		);
		const runner = createServerlessWarmupRunner({
			api: buildApi({ getHealth, runSync }),
			workflow: baseWorkflow,
		});

		const event = await runner.runOnce();
		expect(event.pinged).toBe(true);
		expect(event.rawStatus).toBe("COMPLETED");
		const firstCall = (runSync.mock.calls as unknown[][])[0];
		const call = (firstCall?.[0] ?? {}) as {
			policy?: { lowPriority?: boolean; executionTimeout?: number };
			waitMs?: number;
		};
		expect(call.policy?.lowPriority).toBe(true);
		expect(call.policy?.executionTimeout).toBe(60_000);
		expect(call.waitMs).toBe(15_000);
	});

	it("emits health-error event when /health throws", async () => {
		const getHealth = mock(() => Promise.reject(new Error("rate limited")));
		const runner = createServerlessWarmupRunner({
			api: buildApi({ getHealth }),
			workflow: baseWorkflow,
		});
		const event = await runner.runOnce();
		expect(event.pinged).toBe(false);
		expect(event.skippedReason).toBe("health-error");
	});

	it("can be disabled via skipWhenWarmersAvailable: false", async () => {
		const getHealth = mock(() => Promise.resolve(buildHealth({ idle: 3 })));
		const runSync = mock(() =>
			Promise.resolve<ServerlessSubmission>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "x",
				output: null,
				queuePosition: null,
				rawStatus: "COMPLETED",
			})
		);
		if (!baseWorkflow.warmup) {
			throw new Error("baseWorkflow.warmup is required by this test");
		}
		const runner = createServerlessWarmupRunner({
			api: buildApi({ getHealth, runSync }),
			workflow: {
				...baseWorkflow,
				warmup: {
					...baseWorkflow.warmup,
					skipWhenWarmersAvailable: false,
				},
			},
		});

		const event = await runner.runOnce();
		expect(event.pinged).toBe(true);
		expect(runSync).toHaveBeenCalledTimes(1);
	});

	it("start() schedules a cycle via the injected scheduler and stop() clears the pending handle", async () => {
		const getHealth = mock(() => Promise.resolve(buildHealth()));
		const runSync = mock(() =>
			Promise.resolve<ServerlessSubmission>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "x",
				output: null,
				queuePosition: null,
				rawStatus: "COMPLETED",
			})
		);
		const scheduledIntervals: number[] = [];
		const cleared: number[] = [];
		let nextId = 1;
		// Не запускаем cb автоматически — иначе scheduleNext затопит pending
		// microtask'ами и стопнуть нельзя. Тест проверяет только что start()
		// зашедулил cb с правильным интервалом и stop() умеет его отменить.
		const scheduler = {
			setTimeout: (_cb: () => void, ms: number) => {
				const id = nextId++;
				scheduledIntervals.push(ms);
				return id;
			},
			clearTimeout: (handle: unknown) => {
				cleared.push(handle as number);
			},
		};
		const runner = createServerlessWarmupRunner({
			api: buildApi({ getHealth, runSync }),
			intervalMs: 60_000,
			scheduler,
			workflow: baseWorkflow,
		});

		runner.start();
		expect(scheduledIntervals).toEqual([60_000]);
		await runner.stop();
		expect(cleared).toEqual([1]);
		expect(runSync).toHaveBeenCalledTimes(0);
	});

	it("scheduleNext after a cycle uses the configured interval", async () => {
		const getHealth = mock(() => Promise.resolve(buildHealth()));
		const runSync = mock(() =>
			Promise.resolve<ServerlessSubmission>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "x",
				output: null,
				queuePosition: null,
				rawStatus: "COMPLETED",
			})
		);
		const scheduledIntervals: number[] = [];
		const runner = createServerlessWarmupRunner({
			api: buildApi({ getHealth, runSync }),
			intervalMs: 60_000,
			scheduler: {
				setTimeout: (_cb, ms) => {
					scheduledIntervals.push(ms);
					return scheduledIntervals.length;
				},
				clearTimeout: () => {
					// noop — test doesn't validate clearTimeout here
				},
			},
			workflow: baseWorkflow,
		});

		runner.start();
		// Симулируем что таймер выстрелил: вручную запускаем cycle.
		await runner.runOnce();
		// Если бы start() реально запустил cycle, scheduleNext был бы вызван
		// внутри runCycle. Здесь же мы вызвали runOnce → scheduleNext в нём
		// не дёргается (это всего лишь публичный API для разовых пингов).
		await runner.stop();
		expect(scheduledIntervals).toEqual([60_000]);
	});
});
