import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

import type {
	RunpodServerlessApi,
	ServerlessJobStatus,
	ServerlessSubmission,
} from "../api/serverless";
import type { ServerlessWorkflow } from "../workflow/definition";
import {
	createServerlessEngine,
	type ServerlessCompletedEvent,
	type ServerlessSubmittedEvent,
} from "./serverless-engine";

interface FooocusOutput {
	images: Array<{ url?: string; dataUrl?: string }>;
}

const fooocusInputSchema = z.object({
	prompt: z.string(),
	negativePrompt: z.string().optional(),
});

const fooocusWorkflow: ServerlessWorkflow<
	z.infer<typeof fooocusInputSchema>,
	FooocusOutput
> = {
	id: "fooocus-sdxl",
	mode: "serverless",
	endpointId: "endpoint-x",
	inputSchema: fooocusInputSchema,
	buildPayload(input) {
		return { prompt: input.prompt, api_name: "txt2img" };
	},
	parseOutput(raw) {
		if (!Array.isArray(raw)) {
			throw new Error("expected array output");
		}
		const items = raw as Record<string, unknown>[];
		return {
			images: items.map((item) => ({
				url: typeof item.url === "string" ? item.url : undefined,
				dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : undefined,
			})),
		};
	},
};

function buildApi(
	overrides: Partial<RunpodServerlessApi> = {}
): RunpodServerlessApi {
	return {
		cancel: overrides.cancel ?? mock(() => Promise.resolve()),
		getHealth:
			overrides.getHealth ??
			mock(() =>
				Promise.resolve({
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
				})
			),
		getStatus:
			overrides.getStatus ??
			mock(() =>
				Promise.resolve<ServerlessJobStatus>({
					delayTimeMs: null,
					error: null,
					executionTimeMs: null,
					jobId: "job-1",
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
					jobId: "job-1",
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
					jobId: "sync-1",
					output: null,
					queuePosition: null,
					rawStatus: "IN_QUEUE",
				})
			),
		submit:
			overrides.submit ??
			mock(() =>
				Promise.resolve<ServerlessSubmission>({
					delayTimeMs: null,
					error: null,
					executionTimeMs: null,
					jobId: "job-1",
					output: null,
					queuePosition: null,
					rawStatus: "IN_QUEUE",
				})
			),
	};
}

describe("ServerlessEngine", () => {
	it("validates input, calls api with built payload and merged policy", async () => {
		const submit = mock(() =>
			Promise.resolve<ServerlessSubmission>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "job-9",
				output: null,
				queuePosition: 2,
				rawStatus: "IN_QUEUE",
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ submit }),
			workflow: {
				...fooocusWorkflow,
				defaultPolicy: { executionTimeout: 300_000, ttl: 1_800_000 },
				policy: { ttl: 60 },
			},
		});

		const result = await engine.submit({ prompt: "hi" });

		expect(submit).toHaveBeenCalledWith({
			endpointId: "endpoint-x",
			input: { prompt: "hi", api_name: "txt2img" },
			policy: {
				executionTimeout: 300_000,
				lowPriority: undefined,
				ttl: 1_800_000,
			},
			webhook: undefined,
		});
		expect(result).toMatchObject({
			jobId: "job-9",
			queuePosition: 2,
			status: "queued",
		});
	});

	it("uses /runsync when workflow.runSync.enabled", async () => {
		const runSync = mock(() =>
			Promise.resolve<ServerlessSubmission>({
				delayTimeMs: 200,
				error: null,
				executionTimeMs: 1500,
				jobId: "sync-abc",
				output: [{ url: "https://x/y.png" }],
				queuePosition: null,
				rawStatus: "COMPLETED",
			})
		);
		const submit = mock(() =>
			Promise.reject(new Error("/run should not be called"))
		);
		const engine = createServerlessEngine({
			api: buildApi({ runSync, submit }),
			workflow: {
				...fooocusWorkflow,
				runSync: { enabled: true, waitMs: 30_000 },
			},
		});

		const result = await engine.submit({ prompt: "hi" });
		expect(runSync).toHaveBeenCalledTimes(1);
		const firstCall = (runSync.mock.calls as unknown[][])[0];
		const firstArg = firstCall?.[0] as { waitMs?: number } | undefined;
		expect(firstArg?.waitMs).toBe(30_000);
		expect(result.jobId).toBe("sync-abc");
		expect(result.status).toBe("succeeded");
	});

	it("rejects malformed input via the workflow schema", async () => {
		const engine = createServerlessEngine({
			api: buildApi(),
			workflow: fooocusWorkflow,
		});
		await expect(engine.submit({} as never)).rejects.toThrow();
	});

	it("normalizes COMPLETED into succeeded and runs parseOutput", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				delayTimeMs: 800,
				error: null,
				executionTimeMs: 1300,
				jobId: "job-1",
				output: [{ url: "https://x/y.png" }],
				queuePosition: null,
				rawStatus: "COMPLETED",
				retries: 0,
			})
		);
		const completed: ServerlessCompletedEvent[] = [];
		const submitted: ServerlessSubmittedEvent[] = [];
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			observer: {
				onCompleted: (e) => completed.push(e),
				onSubmitted: (e) => submitted.push(e),
			},
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.status).toBe("succeeded");
		expect(job.progressPct).toBe(100);
		expect(job.output).toEqual({
			images: [{ url: "https://x/y.png", dataUrl: undefined }],
		});
		expect(completed).toEqual([
			{
				delayTimeMs: 800,
				endpointId: "endpoint-x",
				executionTimeMs: 1300,
				jobId: "job-1",
				retries: 0,
				status: "succeeded",
				workflowId: "fooocus-sdxl",
			},
		]);
		expect(submitted).toEqual([]);
	});

	it("normalises RUNNING into running (some workers use it instead of IN_PROGRESS)", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "job-1",
				output: null,
				queuePosition: null,
				rawStatus: "RUNNING",
				retries: null,
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});
		const job = await engine.getStatus("job-1");
		expect(job.status).toBe("running");
	});

	it("converts base64 outputs into data URLs before parseOutput", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "job-1",
				output: [{ base64: "iVBORw0KGgo=" }],
				queuePosition: null,
				rawStatus: "COMPLETED",
				retries: null,
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.output?.images[0]?.dataUrl).toBe(
			"data:image/png;base64,iVBORw0KGgo="
		);
	});

	it("treats top-level errors as failed and extracts nested message", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				delayTimeMs: null,
				error: { message: "lora missing" },
				executionTimeMs: null,
				jobId: "job-1",
				output: null,
				queuePosition: null,
				rawStatus: "FAILED",
				retries: null,
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("lora missing");
		expect(job.output).toBeNull();
	});

	it("treats embedded handler errors (output.error_message / output.traceback) as failures", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "job-1",
				output: {
					error_message: "CUDA OOM",
					traceback: "Traceback (most recent call last)...",
				},
				queuePosition: null,
				rawStatus: "COMPLETED",
				retries: null,
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("CUDA OOM");
	});

	it("falls back to traceback when no message-shaped field is present", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "job-1",
				output: { traceback: "boom\n  at fn (x)" },
				queuePosition: null,
				rawStatus: "COMPLETED",
				retries: null,
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.errorSummary).toBe("boom\n  at fn (x)");
	});

	it("reports parseOutput exceptions as failed instead of throwing", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				delayTimeMs: null,
				error: null,
				executionTimeMs: null,
				jobId: "job-1",
				output: { unexpected: "shape" },
				queuePosition: null,
				rawStatus: "COMPLETED",
				retries: null,
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});
		const job = await engine.getStatus("job-1");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toContain("Failed to parse worker output");
	});

	it("delegates cancel to the api", async () => {
		const cancel = mock(() => Promise.resolve());
		const engine = createServerlessEngine({
			api: buildApi({ cancel }),
			workflow: fooocusWorkflow,
		});
		await engine.cancel("job-1");
		expect(cancel).toHaveBeenCalledWith({
			endpointId: "endpoint-x",
			jobId: "job-1",
		});
	});
});
