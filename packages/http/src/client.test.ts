import { afterEach, describe, expect, it, mock } from "bun:test";

import { requestJson } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("requestJson", () => {
	it("includes credentials by default", async () => {
		const fetchMock = mock(
			async (_input: string | URL | Request, init?: RequestInit) =>
				new Response(JSON.stringify({ credentials: init?.credentials }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
		);

		globalThis.fetch = fetchMock as typeof fetch;

		const payload = await requestJson<{ credentials?: RequestCredentials }>(
			"http://localhost:3003/api/persons"
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");
		expect(payload.credentials).toBe("include");
	});

	it("preserves explicit credentials", async () => {
		const fetchMock = mock(
			async (_input: string | URL | Request, init?: RequestInit) =>
				new Response(JSON.stringify({ credentials: init?.credentials }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
		);

		globalThis.fetch = fetchMock as typeof fetch;

		const payload = await requestJson<{ credentials?: RequestCredentials }>(
			"http://localhost:3003/api/persons",
			{ credentials: "omit" }
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("omit");
		expect(payload.credentials).toBe("omit");
	});
});
