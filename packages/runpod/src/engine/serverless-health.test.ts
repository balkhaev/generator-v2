import { describe, expect, it } from "bun:test";

import type { ServerlessEndpointHealth } from "../api/serverless";
import { assessEndpointHealth } from "./serverless-health";

const MIN_WORKERS_PATTERN = /min workers >= 1/;

function buildHealth(
	overrides: Partial<ServerlessEndpointHealth["workers"]> = {},
	jobs: Partial<ServerlessEndpointHealth["jobs"]> = {}
): ServerlessEndpointHealth {
	return {
		jobs: {
			completed: 0,
			failed: 0,
			inProgress: 0,
			inQueue: 0,
			retried: 0,
			...jobs,
		},
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

describe("assessEndpointHealth", () => {
	it("flags zero warm workers as warning with min-workers recommendation", () => {
		const result = assessEndpointHealth(buildHealth());
		expect(result.healthy).toBe(false);
		expect(result.maxSeverity).toBe("warning");
		expect(result.findings.map((f) => f.code)).toContain("no-active-workers");
		const finding = result.findings.find((f) => f.code === "no-active-workers");
		expect(finding?.recommendation).toMatch(MIN_WORKERS_PATTERN);
	});

	it("reports healthy when at least one worker is warm and queue is calm", () => {
		const result = assessEndpointHealth(buildHealth({ idle: 1 }));
		expect(result.healthy).toBe(true);
		expect(result.maxSeverity).toBe("info");
		expect(result.findings).toEqual([
			{
				code: "healthy",
				message: "Endpoint configuration looks healthy.",
				recommendation: "No action required.",
				severity: "info",
			},
		]);
	});

	it("escalates to critical on scale-out stall (queue without initializing workers)", () => {
		const result = assessEndpointHealth(
			buildHealth({ idle: 0, initializing: 0 }, { inQueue: 3 })
		);
		expect(result.maxSeverity).toBe("critical");
		expect(result.findings.map((f) => f.code)).toContain("scale-out-stalled");
	});

	it("flags unhealthy workers as critical", () => {
		const result = assessEndpointHealth(buildHealth({ idle: 1, unhealthy: 2 }));
		expect(result.maxSeverity).toBe("critical");
		expect(result.findings.map((f) => f.code)).toContain("unhealthy-workers");
	});

	it("warns on throttled capacity even with some warm workers", () => {
		const result = assessEndpointHealth(buildHealth({ idle: 1, throttled: 1 }));
		expect(result.maxSeverity).toBe("warning");
		expect(result.findings.map((f) => f.code)).toContain("throttled-capacity");
	});

	it("identifies queue backlog with no idle workers as handler bottleneck", () => {
		const result = assessEndpointHealth(
			buildHealth(
				{ idle: 0, initializing: 1, running: 1 },
				{ inQueue: 7, inProgress: 1 }
			)
		);
		// scale-out-stalled НЕ срабатывает (initializing > 0), но queue-backlog да
		expect(result.findings.map((f) => f.code)).toContain("queue-backlog");
	});
});
