import { describe, expect, it } from "bun:test";

import { cleanPromptOutput } from "@/clients/prompt-enhance-output";
import {
	STUDIO_VISION_ENHANCE_SYSTEM_PROMPT,
	STUDIO_VISION_ENHANCE_USER_TEMPLATE,
} from "@/clients/prompt-enhance-templates";

describe("prompt enhance output cleanup", () => {
	it("removes common prompt wrappers and normalizes whitespace", () => {
		expect(
			cleanPromptOutput('```text\n"cinematic portrait, low backlight"\n```')
		).toBe("cinematic portrait, low backlight");
	});

	it("rejects model analysis instead of returning it to the user", () => {
		expect(() =>
			cleanPromptOutput(
				"The prompt you provided describes a static scene.\n\n**Conflict:** the brief says one thing.\n\n**Decision:** I will write the prompt."
			)
		).toThrow("Prompt enhance returned analysis");
	});
});

describe("vision prompt enhance template", () => {
	it("handles static briefs without forcing an action timeline", () => {
		expect(STUDIO_VISION_ENHANCE_SYSTEM_PROMPT).toContain(
			"static scene/style/composition brief"
		);
		expect(STUDIO_VISION_ENHANCE_SYSTEM_PROMPT).toContain("no invented action");
		expect(STUDIO_VISION_ENHANCE_SYSTEM_PROMPT).not.toContain(
			"brief that describes an ACTION"
		);
		expect(STUDIO_VISION_ENHANCE_SYSTEM_PROMPT).not.toContain(
			"removing her shirt"
		);
		expect(STUDIO_VISION_ENHANCE_SYSTEM_PROMPT).not.toContain("topless");
	});

	it("passes the user brief through the vision template unchanged", () => {
		const brief =
			"a woman, sitting in a chair, legs crossed, white dress with bare shoulders";

		expect(STUDIO_VISION_ENHANCE_USER_TEMPLATE(brief)).toContain(
			`"""\n${brief}\n"""`
		);
	});
});
