import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type { EventPublisher } from "@generator/events";
import { inferImageFileExtension } from "@generator/storage";

import { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";

type TrainingUpdatedEventInput = Parameters<
	EventPublisher["publishPersonLoraTrainingUpdated"]
>[0];

describe("FalZibLoraTrainingRunner", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mock.restore();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		mock.restore();
	});

	it("prefers content-type over url suffix when naming image files", () => {
		expect(
			inferImageFileExtension({
				contentType: "image/png",
				url: "https://cdn.example.com/reference.jpg",
			})
		).toBe(".png");
		expect(
			inferImageFileExtension({
				contentType: null,
				url: "https://cdn.example.com/reference.jpeg?download=1",
			})
		).toBe(".jpg");
	});

	it("uses Flux image editing with the reference image as input", async () => {
		let capturedUrl: string | null = null;
		let capturedBody: Record<string, unknown> | null = null;

		globalThis.fetch = mock((input, init) => {
			const url = String(input);
			if (url === "https://queue.fal.run/fal-ai/flux-2/edit") {
				capturedUrl = url;
				capturedBody = JSON.parse(String(init?.body)) as Record<
					string,
					unknown
				>;
				return Promise.resolve(
					new Response(
						JSON.stringify({
							request_id: "request-1",
							response_url:
								"https://queue.fal.run/fal-ai/flux-2/edit/requests/request-1",
							status_url:
								"https://queue.fal.run/fal-ai/flux-2/edit/requests/request-1/status",
						}),
						{
							headers: { "content-type": "application/json" },
							status: 200,
						}
					)
				);
			}

			if (
				url ===
				"https://queue.fal.run/fal-ai/flux-2/edit/requests/request-1/status"
			) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							request_id: "request-1",
							status: "COMPLETED",
						}),
						{
							headers: { "content-type": "application/json" },
							status: 200,
						}
					)
				);
			}

			if (
				url === "https://queue.fal.run/fal-ai/flux-2/edit/requests/request-1"
			) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							images: [{ url: "https://cdn.example.com/ref-1.jpg" }],
						}),
						{
							headers: { "content-type": "application/json" },
							status: 200,
						}
					)
				);
			}

			if (
				url === "https://persons-api.example.com/api/internal/lora-trainings"
			) {
				return Promise.resolve(
					new Response(JSON.stringify({ ok: true }), {
						headers: { "content-type": "application/json" },
						status: 200,
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
			runner.run({
				personId: "person-1",
				personName: "Person One",
				personSlug: "person-one",
				referencePhotoUrl: "https://cdn.example.com/reference.jpg",
				trainingRunId: "training-run-1",
			})
		).rejects.toThrow();

		if (capturedUrl === null || capturedBody === null) {
			throw new Error("Expected Fal request payload to be captured");
		}

		expect(String(capturedUrl)).toBe(
			"https://queue.fal.run/fal-ai/flux-2/edit"
		);
		expect((capturedBody as { image_urls?: string[] }).image_urls).toEqual([
			"https://cdn.example.com/reference.jpg",
		]);
	});

	it("uses approved dataset items on confirmation without regenerating references", async () => {
		const fetchCalls: string[] = [];
		const events: TrainingUpdatedEventInput[] = [];

		globalThis.fetch = mock((input) => {
			const url = String(input);
			fetchCalls.push(url);
			if (url === "https://cdn.example.com/approved.png") {
				return Promise.resolve(
					new Response(new Uint8Array([137, 80, 78, 71]), {
						headers: { "content-type": "image/png" },
						status: 200,
					})
				);
			}
			throw new Error(`Unexpected fetch: ${url}`);
		}) as unknown as typeof fetch;

		const runner = new FalZibLoraTrainingRunner({
			apiKey: "fal-test-key",
			eventPublisher: {
				publishPersonLoraTrainingUpdated(input: TrainingUpdatedEventInput) {
					events.push(input);
					return Promise.resolve();
				},
			} as never,
			logger: {
				error: () => undefined,
				info: () => undefined,
			},
			trainingControlToken: "training-token",
		});

		await expect(
			runner.confirmAndTrain({
				approvedItems: [
					{
						caption: "a photo of ohwx_person, approved portrait",
						s3Key: null,
						url: "https://cdn.example.com/approved.png",
						variantId: "original-00",
					},
				],
				personId: "person-1",
				personName: "Person One",
				personSlug: "person-one",
				referencePhotoUrl: "https://cdn.example.com/reference.jpg",
				trainingRunId: "training-run-1",
				triggerWord: "ohwx_person",
			})
		).rejects.toThrow("S3 config is required to persist LoRA dataset");

		expect(fetchCalls).toEqual(["https://cdn.example.com/approved.png"]);
		expect(
			fetchCalls.some((url) => url.includes("queue.fal.run/fal-ai/flux-2/edit"))
		).toBe(false);
		expect(events.at(-1)?.event).toMatchObject({
			provider: "fal",
			status: "failed",
		});
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
