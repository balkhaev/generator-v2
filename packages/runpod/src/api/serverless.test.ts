import { describe, expect, it, mock } from "bun:test";

import { createRunpodHttpClient } from "../http/client";
import { createServerlessApi } from "./serverless";

function createApi(fetchImpl: ReturnType<typeof mock>) {
	const http = createRunpodHttpClient({
		apiKey: "rpa_test",
		baseUrl: "https://api.runpod.ai/v2",
		fetchImpl,
		sleep: () => Promise.resolve(),
	});
	return createServerlessApi(http);
}

describe("RunpodServerlessApi", () => {
	it("submits the input under the canonical { input } envelope", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://api.runpod.ai/v2/endpoint-x/run");
			expect(init?.method).toBe("POST");
			expect(JSON.parse(String(init?.body))).toEqual({
				input: { prompt: "hi" },
				policy: { ttl: 60 },
			});
			return Promise.resolve(
				Response.json({ id: "job-1", status: "IN_QUEUE", queuePosition: 3 })
			);
		});
		const api = createApi(fetchImpl);

		const submission = await api.submit({
			endpointId: "endpoint-x",
			input: { prompt: "hi" },
			policy: { ttl: 60 },
		});

		expect(submission).toEqual({
			delayTimeMs: null,
			error: null,
			executionTimeMs: null,
			jobId: "job-1",
			output: null,
			queuePosition: 3,
			rawStatus: "IN_QUEUE",
		});
	});

	it("passes webhook URL through when provided", async () => {
		const fetchImpl = mock((_url: string, init?: RequestInit) => {
			expect(JSON.parse(String(init?.body))).toEqual({
				input: { prompt: "hi" },
				webhook: "https://hook.example/cb",
			});
			return Promise.resolve(
				Response.json({ id: "job-9", status: "IN_QUEUE" })
			);
		});
		const api = createApi(fetchImpl);
		await api.submit({
			endpointId: "endpoint-x",
			input: { prompt: "hi" },
			webhook: "https://hook.example/cb",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("returns a typed status snapshot with output, error, delayTime and executionTime", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				Response.json({
					id: "job-1",
					status: "COMPLETED",
					output: { images: [{ url: "https://x/y.png" }] },
					delayTime: 1234,
					executionTime: 5678,
					retries: 1,
				})
			)
		);
		const api = createApi(fetchImpl);

		const status = await api.getStatus({
			endpointId: "endpoint-x",
			jobId: "job-1",
		});

		expect(status).toEqual({
			delayTimeMs: 1234,
			error: null,
			executionTimeMs: 5678,
			jobId: "job-1",
			output: { images: [{ url: "https://x/y.png" }] },
			queuePosition: null,
			rawStatus: "COMPLETED",
			retries: 1,
		});
	});

	it("posts to /cancel/<jobId>", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe("https://api.runpod.ai/v2/endpoint-x/cancel/job-1");
			expect(init?.method).toBe("POST");
			return Promise.resolve(
				Response.json({ id: "job-1", status: "CANCELLED" })
			);
		});
		const api = createApi(fetchImpl);

		await api.cancel({ endpointId: "endpoint-x", jobId: "job-1" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("runSync uses /runsync with wait query and returns terminal output", async () => {
		const fetchImpl = mock((url: string, init?: RequestInit) => {
			expect(url).toBe(
				"https://api.runpod.ai/v2/endpoint-x/runsync?wait=15000"
			);
			expect(init?.method).toBe("POST");
			return Promise.resolve(
				Response.json({
					id: "sync-1",
					status: "COMPLETED",
					output: [{ url: "https://x/y.png" }],
					delayTime: 220,
					executionTime: 1300,
				})
			);
		});
		const api = createApi(fetchImpl);

		const result = await api.runSync({
			endpointId: "endpoint-x",
			input: { prompt: "hi" },
			waitMs: 15_000,
		});

		expect(result.jobId).toBe("sync-1");
		expect(result.rawStatus).toBe("COMPLETED");
		expect(result.output).toEqual([{ url: "https://x/y.png" }]);
		expect(result.delayTimeMs).toBe(220);
		expect(result.executionTimeMs).toBe(1300);
	});

	it("getHealth normalises workers + jobs blocks even if upstream omits fields", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				Response.json({
					jobs: { completed: 5, inQueue: 1 },
					workers: { idle: 2, running: 1 },
				})
			)
		);
		const api = createApi(fetchImpl);
		const health = await api.getHealth({ endpointId: "endpoint-x" });
		expect(health.workers).toEqual({
			idle: 2,
			initializing: 0,
			ready: 0,
			running: 1,
			throttled: 0,
			unhealthy: 0,
		});
		expect(health.jobs).toEqual({
			completed: 5,
			failed: 0,
			inProgress: 0,
			inQueue: 1,
			retried: 0,
		});
	});

	it("purgeQueue and retry hit the right paths", async () => {
		const calls: string[] = [];
		const fetchImpl = mock((url: string) => {
			calls.push(url);
			if (url.endsWith("/purge-queue")) {
				return Promise.resolve(
					Response.json({ removed: 2, status: "completed" })
				);
			}
			return Promise.resolve(
				Response.json({ id: "job-1", status: "IN_QUEUE" })
			);
		});
		const api = createApi(fetchImpl);
		const purged = await api.purgeQueue({ endpointId: "endpoint-x" });
		expect(purged).toEqual({ removed: 2, status: "completed" });

		await api.retry({ endpointId: "endpoint-x", jobId: "job-1" });
		expect(calls).toEqual([
			"https://api.runpod.ai/v2/endpoint-x/purge-queue",
			"https://api.runpod.ai/v2/endpoint-x/retry/job-1",
		]);
	});
});
