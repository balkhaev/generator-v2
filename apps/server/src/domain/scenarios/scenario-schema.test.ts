import { describe, expect, test } from "bun:test";

import { createScenarioDraftSchema, scenarioRunDraftSchema } from "./scenario-schema";

const scenarioDraftSchema = createScenarioDraftSchema(["ltx-2.3 i2v"]);

describe("createScenarioDraftSchema", () => {
	test("accepts a reusable scenario payload for the MVP workflow", () => {
		const result = scenarioDraftSchema.safeParse({
			name: "Cinematic beach pan",
			workflowKey: "ltx-2.3 i2v",
			prompt: "Turn the source image into a slow cinematic camera move.",
			params: {
				seed: 42,
				guidanceScale: 3.5,
				loop: false,
			},
		});

		expect(result.success).toBe(true);
	});

	test("rejects missing workflow keys, invalid workflow keys, and non-object params", () => {
		const missingWorkflow = scenarioDraftSchema.safeParse({
			name: "Missing workflow",
			prompt: "Prompt",
			params: {},
		});
		const invalidWorkflow = scenarioDraftSchema.safeParse({
			name: "Wrong workflow",
			workflowKey: "unknown-workflow",
			prompt: "Prompt",
			params: {},
		});
		const invalidParams = scenarioDraftSchema.safeParse({
			name: "Bad params",
			workflowKey: "ltx-2.3 i2v",
			prompt: "Prompt",
			params: "not-an-object",
		});

		expect(missingWorkflow.success).toBe(false);
		expect(invalidWorkflow.success).toBe(false);
		expect(invalidParams.success).toBe(false);
	});
});

describe("scenarioRunDraftSchema", () => {
	test("requires a scenario id plus an input image reference", () => {
		const validRun = scenarioRunDraftSchema.safeParse({
			scenarioId: "scenario_123",
			inputImage: {
				assetUrl: "https://assets.internal.example/input-a.png",
				filename: "input-a.png",
				mimeType: "image/png",
			},
		});
		const invalidRun = scenarioRunDraftSchema.safeParse({
			scenarioId: "scenario_123",
			inputImage: {
				assetUrl: "not-a-url",
				filename: "",
				mimeType: "",
			},
		});

		expect(validRun.success).toBe(true);
		expect(invalidRun.success).toBe(false);
	});
});
