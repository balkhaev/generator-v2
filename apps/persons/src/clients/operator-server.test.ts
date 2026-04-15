import { describe, expect, it, mock } from "bun:test";
import { GENERATOR_INTERNAL_TOKEN_HEADER } from "@generator/http/shared";

import { createOperatorServerClient } from "./operator-server";

describe("createOperatorServerClient", () => {
	it("sends the generator internal token when configured", async () => {
		const fetchImpl = mock(
			(_input: string | URL | Request, _init?: RequestInit) =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							execution: {
								artifacts: [],
								errorSummary: null,
								id: "execution-1",
								inputImageUrl: "",
								providerEndpointId: null,
								providerJobId: "job-1",
								status: "queued",
								workflowKey: "fal-zimage-turbo",
							},
						}),
						{
							headers: {
								"content-type": "application/json",
							},
							status: 200,
						}
					)
				)
		);
		const client = createOperatorServerClient(
			"https://generator-api.example.com",
			{
				fetchImpl,
				internalToken: "internal-token-1",
			}
		);

		await client.createExecution({
			prompt: "test prompt",
			workflowKey: "fal-zimage-turbo",
		});

		const [, init] = fetchImpl.mock.calls[0] ?? [];
		const headers = new Headers(init?.headers);

		expect(headers.get(GENERATOR_INTERNAL_TOKEN_HEADER)).toBe(
			"internal-token-1"
		);
	});
});
