import { afterEach, describe, expect, it, mock } from "bun:test";

const originalAdminApiUrl = process.env.ADMIN_API_URL;
const originalFetch = globalThis.fetch;

afterEach(() => {
	if (originalAdminApiUrl === undefined) {
		process.env.ADMIN_API_URL = undefined;
	} else {
		process.env.ADMIN_API_URL = originalAdminApiUrl;
	}
	globalThis.fetch = originalFetch;
});

describe("collectServiceHealth", () => {
	it("uses configured service base urls for health checks", async () => {
		process.env.ADMIN_API_URL = "https://admin-api.gen.balkhaev.com";
		const calls: string[] = [];

		globalThis.fetch = mock((input: string | URL | Request) => {
			calls.push(String(input));
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true }), {
					headers: {
						"content-type": "application/json",
					},
					status: 200,
				})
			);
		}) as unknown as typeof fetch;

		const { collectServiceHealth } = await import(
			`./shared.ts?case=${crypto.randomUUID()}`
		);

		await collectServiceHealth(["admin"]);

		expect(calls).toEqual(["https://admin-api.gen.balkhaev.com/api/health"]);
	});
});
