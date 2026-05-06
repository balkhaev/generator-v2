import { describe, expect, it, mock } from "bun:test";

import { createRunpodHttpClient } from "../http/client";
import { createServerlessApi } from "./serverless";

function createApi(fetchImpl: ReturnType<typeof mock>) {
	const http = createRunpodHttpClient({
		apiKey: "rpa_test",
		baseUrl: "https://api.runpod.ai/v2",
		fetchImpl,
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
			jobId: "job-1",
			queuePosition: 3,
			rawStatus: "IN_QUEUE",
		});
	});

	it("returns a typed status snapshot with output and error preserved", async () => {
		const fetchImpl = mock(() =>
			Promise.resolve(
				Response.json({
					id: "job-1",
					status: "COMPLETED",
					output: { images: [{ url: "https://x/y.png" }] },
				})
			)
		);
		const api = createApi(fetchImpl);

		const status = await api.getStatus({
			endpointId: "endpoint-x",
			jobId: "job-1",
		});

		expect(status).toEqual({
			error: null,
			jobId: "job-1",
			output: { images: [{ url: "https://x/y.png" }] },
			queuePosition: null,
			rawStatus: "COMPLETED",
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
});
