import { describe, expect, it } from "bun:test";

import { seedRunpodTemplatesFromEnv } from "@/providers/runpod-template-seed";

describe("seedRunpodTemplatesFromEnv (resilience)", () => {
	it("returns null when runpod_pod_template table is missing", async () => {
		const fakeDb = {
			select() {
				return {
					from() {
						const error = new Error(
							'relation "runpod_pod_template" does not exist'
						);
						(error as unknown as { code: string }).code = "42P01";
						return Promise.reject(error);
					},
				};
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
		const result = await seedRunpodTemplatesFromEnv({
			database: fakeDb as never,
			logger,
		});
		expect(result).toBeNull();
		expect(warns.length).toBeGreaterThan(0);
	});

	it("propagates unrelated select errors", async () => {
		const fakeDb = {
			select() {
				return {
					from() {
						return Promise.reject(new Error("connection refused"));
					},
				};
			},
		};
		await expect(
			seedRunpodTemplatesFromEnv({
				database: fakeDb as never,
				logger: console,
			})
		).rejects.toThrow("connection refused");
	});

	it("returns null when table is non-empty (idempotent)", async () => {
		const fakeDb = {
			select() {
				return {
					from() {
						return Promise.resolve([{ templateCount: 3 }]);
					},
				};
			},
		};
		const result = await seedRunpodTemplatesFromEnv({
			database: fakeDb as never,
			logger: console,
		});
		expect(result).toBeNull();
	});
});
