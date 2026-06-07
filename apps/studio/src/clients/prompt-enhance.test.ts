import { describe, expect, it } from "bun:test";

import {
	analyzeEnhancedOutput,
	cleanPromptOutput,
	EnhanceOutputError,
} from "@/clients/prompt-enhance-output";
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

	it("rejects content-policy refusals instead of leaking them as the prompt", () => {
		expect(() =>
			cleanPromptOutput(
				"I cannot generate prompts containing sexually explicit content or descriptions of sexual acts. I can, however, help you create a prompt that focuses on the fashion, lighting, and pose of the subject in the reference image without the explicit action."
			)
		).toThrow("refused by the model");

		expect(() =>
			cleanPromptOutput("I'm sorry, but I can't help with that request.")
		).toThrow("refused by the model");
	});

	it("rejects reasoning chain-of-thought dumps instead of leaking them", () => {
		const reasoningDump =
			"The prompt provided is in Russian and describes an action. Per the system instructions, I must preserve the action.\n\n**Prompt Construction:**\n* Subject: blonde woman\n* Action: jumps\n\n**Drafting:**\nA blonde woman in lingerie on a bed.\n\n**Final Prompt:**\nA blonde woman in purple floral lingerie lying on a messy bed.";
		expect(() => cleanPromptOutput(reasoningDump)).toThrow(
			"Prompt enhance returned analysis"
		);
	});

	it("does not flag legitimate comma-separated prompts as refusals", () => {
		const prompt =
			"nude woman standing on a wooden deck, sepia tones, soft window light, 85mm lens, shallow depth of field, fine-art photography";
		expect(cleanPromptOutput(prompt)).toBe(prompt);
	});

	it("recovers the prompt from a benign single-line preamble", () => {
		expect(
			cleanPromptOutput(
				"Here is the enhanced prompt:\n\nblonde woman in lingerie on a bed, dim warm light, static shot"
			)
		).toBe("blonde woman in lingerie on a bed, dim warm light, static shot");
		expect(
			cleanPromptOutput('Enhanced prompt: "cinematic portrait, soft light"')
		).toBe("cinematic portrait, soft light");
	});

	it("rejects bullet/numbered reasoning structures without bold headers", () => {
		const bulletDump =
			"Subject is a woman.\n- she is lying down\n- then she jumps\n- breasts shake";
		expect(() => cleanPromptOutput(bulletDump)).toThrow(
			"Prompt enhance returned analysis"
		);
	});

	it("rejects degenerate too-short output", () => {
		expect(() => cleanPromptOutput("ok.")).toThrow("too short");
	});

	it("exposes machine-readable reason codes via analyzeEnhancedOutput", () => {
		expect(
			analyzeEnhancedOutput("I'm sorry, I can't help with that.")
		).toMatchObject({ ok: false, reason: "refusal" });
		expect(
			analyzeEnhancedOutput("**Final Prompt:** a woman on a bed")
		).toMatchObject({ ok: false, reason: "reasoning_dump" });
		expect(analyzeEnhancedOutput("   ")).toMatchObject({
			ok: false,
			reason: "empty",
		});
		const good = analyzeEnhancedOutput(
			"a woman on a bed, soft window light, 85mm lens, shallow depth of field"
		);
		expect(good.ok).toBe(true);
	});

	it("throws a typed EnhanceOutputError carrying the reason", () => {
		try {
			cleanPromptOutput("As an AI, I cannot do that.");
			throw new Error("expected to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(EnhanceOutputError);
			expect((error as EnhanceOutputError).reason).toBe("refusal");
		}
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
