import { describe, expect, it } from "bun:test";

import { buildPromptWithTriggerWords } from "@/domain/studio";

describe("buildPromptWithTriggerWords", () => {
	it("prepends new trigger words to the prompt", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "a quiet street at night",
				triggerWords: ["mystic", "neon city"],
			})
		).toBe("mystic, neon city, a quiet street at night");
	});

	it("skips trigger words that are already present (case-insensitive)", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "Mystic vibe with neon city lights",
				triggerWords: ["mystic", "neon city"],
			})
		).toBe("Mystic vibe with neon city lights");
	});

	it("de-duplicates trigger words case-insensitively", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "a portrait",
				triggerWords: ["alpha", "Alpha", "beta"],
			})
		).toBe("alpha, beta, a portrait");
	});

	it("ignores blank entries", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "p",
				triggerWords: ["", "  ", "x"],
			})
		).toBe("x, p");
	});

	it("returns the original prompt when there are no trigger words", () => {
		expect(
			buildPromptWithTriggerWords({
				prompt: "p",
				triggerWords: [],
			})
		).toBe("p");
	});
});
