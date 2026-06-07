import { describe, expect, it } from "bun:test";

import { eventNames, generatorExecutionUpdatedEventSchema } from "./index";

const baseEvent = {
	version: 1 as const,
	id: "evt-1",
	name: eventNames.generatorExecutionUpdated,
	occurredAt: new Date().toISOString(),
	source: "generator-test",
};

const baseExecution = {
	artifacts: [],
	errorSummary: null,
	id: "exec-1",
	inputImageUrl: "",
	providerEndpointId: null,
	providerJobId: null,
	status: "queued" as const,
	workflowKey: "runpod-fooocus-sdxl",
};

describe("generatorExecutionUpdatedEventSchema", () => {
	it("accepts events without new progress fields (backward compat)", () => {
		const parsed = generatorExecutionUpdatedEventSchema.parse({
			...baseEvent,
			data: {
				context: { runId: "run-1" },
				execution: baseExecution,
			},
		});
		expect(parsed.data.execution.id).toBe("exec-1");
		expect(parsed.data.execution).not.toHaveProperty("progressPct");
	});

	it("accepts events with the full live-progress payload", () => {
		const parsed = generatorExecutionUpdatedEventSchema.parse({
			...baseEvent,
			data: {
				context: { runId: "run-1" },
				execution: {
					...baseExecution,
					etaMs: 5000,
					lastLogLine: "Sampling step 12/40",
					phase: "running" as const,
					progressPct: 42,
					queuePosition: 0,
					status: "running" as const,
				},
			},
		});
		expect(parsed.data.execution.progressPct).toBe(42);
		expect(parsed.data.execution.phase).toBe("running");
		expect(parsed.data.execution.etaMs).toBe(5000);
	});

	it("rejects unknown phase values to keep enum strict", () => {
		const result = generatorExecutionUpdatedEventSchema.safeParse({
			...baseEvent,
			data: {
				context: {},
				execution: {
					...baseExecution,
					phase: "unknown",
				},
			},
		});
		expect(result.success).toBe(false);
	});
});
