import { describe, expect, it } from "bun:test";

import { derivePhaseAndProgress } from "@/domain/executions";

const WORKFLOW_KEY = "fal-flux-schnell";

function input(
	overrides: Partial<Parameters<typeof derivePhaseAndProgress>[0]>
) {
	return {
		createdAt: new Date(Date.now() - 5000),
		jobSnapshot: null,
		persistedProgressPct: null,
		providerJobId: null,
		status: "queued" as const,
		updatedAt: new Date(),
		workflowKey: WORKFLOW_KEY,
		...overrides,
	};
}

describe("derivePhaseAndProgress", () => {
	it("returns 100/done for succeeded", () => {
		expect(derivePhaseAndProgress(input({ status: "succeeded" }))).toEqual({
			etaMs: 0,
			phase: "done",
			progressPct: 100,
		});
	});

	it("returns 100/failed for failed", () => {
		expect(derivePhaseAndProgress(input({ status: "failed" }))).toEqual({
			etaMs: 0,
			phase: "failed",
			progressPct: 100,
		});
	});

	it("phase=submitting when queued without providerJobId", () => {
		const result = derivePhaseAndProgress(input({ status: "queued" }));
		expect(result.phase).toBe("submitting");
		expect(result.progressPct).toBe(0);
	});

	it("keeps queued progress at 0 even with stale provider progress", () => {
		const result = derivePhaseAndProgress(
			input({
				jobSnapshot: { progressPct: 45, queuePosition: 2 },
				persistedProgressPct: 30,
				providerJobId: "job-1",
				status: "queued",
			})
		);
		expect(result.phase).toBe("in_queue");
		expect(result.progressPct).toBe(0);
	});

	it("phase=in_queue when queue_position > 0", () => {
		const result = derivePhaseAndProgress(
			input({
				jobSnapshot: { queuePosition: 3 },
				providerJobId: "job-1",
				status: "queued",
			})
		);
		expect(result.phase).toBe("in_queue");
	});

	it("phase=queued when providerJobId set and queue_position=0", () => {
		const result = derivePhaseAndProgress(
			input({
				jobSnapshot: { queuePosition: 0 },
				providerJobId: "job-1",
				status: "queued",
			})
		);
		expect(result.phase).toBe("queued");
	});

	it("never decreases below persisted progress", () => {
		const result = derivePhaseAndProgress(
			input({
				createdAt: new Date(),
				jobSnapshot: { progressPct: 5 },
				persistedProgressPct: 70,
				providerJobId: "job-1",
				status: "running",
			})
		);
		expect(result.progressPct).toBeGreaterThanOrEqual(70);
		expect(result.progressPct).toBeLessThanOrEqual(95);
	});

	it("uses real provider progress as floor", () => {
		const result = derivePhaseAndProgress(
			input({
				createdAt: new Date(),
				jobSnapshot: { progressPct: 60 },
				persistedProgressPct: 0,
				providerJobId: "job-1",
				status: "running",
			})
		);
		expect(result.progressPct).toBeGreaterThanOrEqual(60);
	});

	it("starts running soft progress from updatedAt instead of queue age", () => {
		const result = derivePhaseAndProgress(
			input({
				createdAt: new Date(Date.now() - 10 * 60_000),
				providerJobId: "job-1",
				status: "running",
				updatedAt: new Date(),
			})
		);
		expect(result.progressPct).toBe(8);
	});

	it("caps progress at 90 even with very long running elapsed", () => {
		const longAgo = new Date(Date.now() - 10 * 60_000);
		const result = derivePhaseAndProgress(
			input({
				createdAt: longAgo,
				jobSnapshot: null,
				persistedProgressPct: null,
				providerJobId: "job-1",
				status: "running",
				updatedAt: longAgo,
			})
		);
		expect(result.progressPct).toBeLessThanOrEqual(90);
	});

	it("etaMs is positive for running and decreases over time", () => {
		const t1 = derivePhaseAndProgress(
			input({
				createdAt: new Date(Date.now() - 1000),
				providerJobId: "job-1",
				status: "running",
				updatedAt: new Date(Date.now() - 1000),
			})
		);
		const t2 = derivePhaseAndProgress(
			input({
				createdAt: new Date(Date.now() - 5000),
				providerJobId: "job-1",
				status: "running",
				updatedAt: new Date(Date.now() - 5000),
			})
		);
		expect(t1.etaMs).not.toBeNull();
		expect(t2.etaMs).not.toBeNull();
		expect((t2.etaMs ?? 0) <= (t1.etaMs ?? 0)).toBe(true);
	});
});
