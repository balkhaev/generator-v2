import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";

describe("FalZibLoraTrainingRunner", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mock.restore();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		mock.restore();
	});

	it("fails when the persons training callback returns a non-2xx response", async () => {
		let callbackAttempts = 0;

		globalThis.fetch = mock((input) => {
			const url = String(input);

			if (
				url === "https://persons-api.example.com/api/internal/lora-trainings"
			) {
				callbackAttempts += 1;
				return Promise.resolve(
					new Response(JSON.stringify({ error: "Unauthorized callback" }), {
						headers: { "content-type": "application/json" },
						status: 401,
					})
				);
			}

			throw new Error(`Unexpected fetch: ${url}`);
		}) as unknown as typeof fetch;

		const runner = new FalZibLoraTrainingRunner({
			apiKey: "fal-test-key",
			logger: {
				error: () => undefined,
				info: () => undefined,
			},
			personsApiBaseUrl: "https://persons-api.example.com",
			trainingControlToken: "training-token",
		});

		await expect(
			(
				runner as unknown as {
					sendTrainingEvent: (input: {
						event: { status: "generating"; triggerWord: string };
						personId: string;
					}) => Promise<void>;
				}
			).sendTrainingEvent({
				event: { status: "generating", triggerWord: "person_one" },
				personId: "person-1",
			})
		).rejects.toThrow("Training callback failed (401): Unauthorized callback");
		expect(callbackAttempts).toBe(3);
	});
});
