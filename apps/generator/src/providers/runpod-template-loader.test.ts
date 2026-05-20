import { describe, expect, it } from "bun:test";

import { loadRunpodWorkflowsFromDb } from "@/providers/runpod-template-loader";

/**
 * При rollout порядок Coolify билдов не гарантирован: db-migrate может
 * стартовать позже чем generator-api. Loader должен это терпеть и просто
 * откатиться на env-defaults вместо аварийного стопа.
 */
describe("loadRunpodWorkflowsFromDb (resilience)", () => {
	it("returns [] when runpod tables don't exist yet", async () => {
		const fakeDb = {
			select() {
				return this;
			},
			from() {
				return this;
			},
			where() {
				return this;
			},
			orderBy() {
				const error = new Error(
					'relation "runpod_pod_template" does not exist'
				);
				(error as unknown as { code: string }).code = "42P01";
				return Promise.reject(error);
			},
		};
		const warns: unknown[] = [];
		const logger = {
			info: () => {
				// no-op
			},
			warn: (...args: unknown[]) => {
				warns.push(args);
			},
		};
		const workflows = await loadRunpodWorkflowsFromDb({
			database: fakeDb as never,
			logger,
		});
		expect(workflows).toEqual([]);
		expect(warns.length).toBeGreaterThan(0);
	});

	it("propagates unrelated database errors", async () => {
		const fakeDb = {
			select() {
				return this;
			},
			from() {
				return this;
			},
			where() {
				return this;
			},
			orderBy() {
				return Promise.reject(new Error("connection refused"));
			},
		};
		await expect(
			loadRunpodWorkflowsFromDb({
				database: fakeDb as never,
				logger: console,
			})
		).rejects.toThrow("connection refused");
	});
});
