import { describe, expect, it } from "bun:test";

import { createInMemoryWarmPodPool } from "./warm-pod-pool";

function entry(podId: string) {
	return {
		networkVolumeId: "vol-1",
		password: "pw",
		podId,
	};
}

const TTL = 60_000;

describe("createInMemoryWarmPodPool cap", () => {
	it("admits pods up to the cap and rejects the overflow", async () => {
		const pool = createInMemoryWarmPodPool({ maxPerWorkflow: 2 });
		expect(await pool.release("wf", entry("a"), TTL)).toBe(true);
		expect(await pool.release("wf", entry("b"), TTL)).toBe(true);
		expect(await pool.release("wf", entry("c"), TTL)).toBe(false);
		const live = await pool.list();
		expect(live.map((e) => e.podId).sort()).toEqual(["a", "b"]);
	});

	it("treats re-release of a pooled pod as idempotent even at cap", async () => {
		const pool = createInMemoryWarmPodPool({ maxPerWorkflow: 1 });
		expect(await pool.release("wf", entry("a"), TTL)).toBe(true);
		// Same podId again must succeed (refresh), not be rejected by the cap.
		expect(await pool.release("wf", entry("a"), TTL)).toBe(true);
		const live = await pool.list();
		expect(live).toHaveLength(1);
	});

	it("frees capacity once entries expire", async () => {
		let nowMs = 1000;
		const pool = createInMemoryWarmPodPool({
			maxPerWorkflow: 1,
			now: () => nowMs,
		});
		expect(await pool.release("wf", entry("a"), TTL)).toBe(true);
		expect(await pool.release("wf", entry("b"), TTL)).toBe(false);
		nowMs += TTL + 1;
		// "a" has expired, so "b" can now take its slot.
		expect(await pool.release("wf", entry("b"), TTL)).toBe(true);
	});

	it("is unbounded when no cap is configured", async () => {
		const pool = createInMemoryWarmPodPool();
		for (const id of ["a", "b", "c", "d", "e"]) {
			expect(await pool.release("wf", entry(id), TTL)).toBe(true);
		}
		expect(await pool.list()).toHaveLength(5);
	});

	it("caps each workflow independently", async () => {
		const pool = createInMemoryWarmPodPool({ maxPerWorkflow: 1 });
		expect(await pool.release("wf-1", entry("a"), TTL)).toBe(true);
		expect(await pool.release("wf-2", entry("b"), TTL)).toBe(true);
		expect(await pool.release("wf-1", entry("c"), TTL)).toBe(false);
	});
});
