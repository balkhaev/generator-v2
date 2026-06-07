import { describe, expect, it } from "bun:test";

import {
	classifyInferenceError,
	deriveProvider,
	emitInferenceMetric,
	INFERENCE_METRIC_EVENT,
} from "@/observability/inference-metrics";

describe("deriveProvider", () => {
	it("maps known workflow key prefixes to providers", () => {
		expect(deriveProvider("fal-flux-schnell")).toBe("fal");
		expect(deriveProvider("runpod-fooocus-sdxl")).toBe("runpod");
		expect(deriveProvider("replicate-flux-dev-lora")).toBe("replicate");
		expect(deriveProvider("civitai-ltx-2-3-synth-t2v")).toBe("civitai");
	});

	it("falls back to unknown for unrecognized prefixes", () => {
		expect(deriveProvider("mystery-workflow")).toBe("unknown");
		expect(deriveProvider("")).toBe("unknown");
	});
});

describe("classifyInferenceError", () => {
	it("returns unknown for an absent summary", () => {
		expect(classifyInferenceError(null)).toBe("unknown");
		expect(classifyInferenceError(undefined)).toBe("unknown");
		expect(classifyInferenceError("")).toBe("unknown");
	});

	it("buckets known error shapes", () => {
		expect(classifyInferenceError("Execution cancelled by operator")).toBe(
			"cancelled"
		);
		expect(
			classifyInferenceError("Failed to persist artifacts to S3: timeout")
		).toBe("persist_failed");
		expect(
			classifyInferenceError(
				"Execution stayed queued too long. The worker pool is likely unhealthy."
			)
		).toBe("stuck_queue");
		expect(classifyInferenceError("RunPod no capacity available")).toBe(
			"capacity"
		);
		expect(classifyInferenceError("OpenRouter request timed out")).toBe(
			"timeout"
		);
		expect(classifyInferenceError("model is not a valid model")).toBe(
			"dead_slug"
		);
		expect(classifyInferenceError("content violates usage policy")).toBe(
			"moderation"
		);
	});

	it("returns provider_error for a non-empty unmatched summary", () => {
		expect(classifyInferenceError("some weird upstream 500")).toBe(
			"provider_error"
		);
	});
});

describe("emitInferenceMetric", () => {
	it("logs one structured line under the stable event name", () => {
		const calls: [string, unknown][] = [];
		emitInferenceMetric(
			{
				info: (msg: string, payload?: unknown) => {
					calls.push([msg, payload]);
				},
			},
			{
				durationMs: 1234,
				metric: "succeeded",
				provider: "fal",
				status: "succeeded",
				workflowKey: "fal-flux-schnell",
			}
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[0]).toBe(INFERENCE_METRIC_EVENT);
		expect(calls[0]?.[1]).toMatchObject({
			metric: "succeeded",
			provider: "fal",
			workflowKey: "fal-flux-schnell",
		});
	});

	it("never throws even if the logger throws", () => {
		expect(() =>
			emitInferenceMetric(
				{
					info: () => {
						throw new Error("logger exploded");
					},
				},
				{ metric: "failed", provider: "runpod", workflowKey: "runpod-x" }
			)
		).not.toThrow();
	});
});
