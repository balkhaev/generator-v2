import { describe, expect, it, mock } from "bun:test";

import { createCivitaiLtx23InferenceChecker } from "@/providers/civitai-ltx23-inference";

describe("createCivitaiLtx23InferenceChecker", () => {
	it("returns unavailable when Civitai has no provider", async () => {
		const fetchImpl = mock((input: string | URL | Request) => {
			expect(input.toString()).toBe(
				"https://orchestration-new.civitai.com/v2/consumer/workflows?hideMatureContent=false&wait=0&whatif=true"
			);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						detail: "No available provider supports this job.",
					}),
					{ status: 400 }
				)
			);
		});
		const checker = createCivitaiLtx23InferenceChecker({
			apiKey: "civitai-token",
			fetchImpl,
		});

		await expect(
			checker.check({ modelId: 2_509_189, versionId: 2_820_451 })
		).resolves.toEqual({
			reason:
				"Selected Civitai LoRA (model 2509189 / version 2820451) has no available Civitai inference for LTX 2.3.",
			status: "unavailable",
			target: "civitai-ltx-2-3",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("returns available when workflow preflight has provider support", async () => {
		const checker = createCivitaiLtx23InferenceChecker({
			apiKey: "civitai-token",
			fetchImpl: mock(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							steps: [
								{
									jobs: [
										{
											queuePosition: { support: "available" },
											status: "scheduled",
										},
									],
								},
							],
						}),
						{ status: 200 }
					)
				)
			),
		});

		await expect(
			checker.check({ modelId: 2_509_189, versionId: 2_820_451 })
		).resolves.toEqual({
			status: "available",
			target: "civitai-ltx-2-3",
		});
	});

	it("accepts sourceVersionId from resolved LoRA source objects", async () => {
		let requestBody: unknown = null;
		const checker = createCivitaiLtx23InferenceChecker({
			apiKey: "civitai-token",
			fetchImpl: mock((_input, init) => {
				requestBody = JSON.parse(String(init?.body));
				return Promise.resolve(
					new Response(JSON.stringify({ steps: [] }), { status: 200 })
				);
			}),
		});

		await expect(
			checker.check({ modelId: 2_509_189, sourceVersionId: 2_820_451 })
		).resolves.toEqual({
			status: "available",
			target: "civitai-ltx-2-3",
		});

		const body = requestBody as { steps: Record<string, unknown>[] };
		const firstStep = body.steps[0];
		if (!firstStep) {
			throw new Error("Expected Civitai preflight step.");
		}
		const input = firstStep.input as { loras: Record<string, number> };
		expect(input.loras).toEqual({
			"urn:air:ltxv23:lora:civitai:2509189@2820451": 1,
		});
	});
});
