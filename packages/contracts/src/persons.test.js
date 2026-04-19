import { describe, expect, it } from "bun:test";
import {
	getPersonLoraTrainingDisplayStatus,
	getPersonLoraTrainingPhaseLabel,
	getPersonLoraTrainingProgressPct,
} from "./persons";

describe("person LoRA training display helpers", () => {
	it("keeps active retraining visible when an older LoRA already exists", () => {
		const training = {
			phase: "polling-training",
			progressPct: 76,
			status: "training",
			trainingElapsedMs: 15 * 60 * 1000,
		};
		expect(getPersonLoraTrainingDisplayStatus(training, true)).toBe("training");
		expect(getPersonLoraTrainingPhaseLabel(training, true)).toBe(
			"Training LoRA weights"
		);
		expect(getPersonLoraTrainingProgressPct(training, true)).toBeGreaterThan(
			76
		);
	});
	it("falls back to ready only when there is no active training job", () => {
		expect(getPersonLoraTrainingDisplayStatus(null, true)).toBe("ready");
		expect(getPersonLoraTrainingProgressPct(null, true)).toBe(100);
		expect(getPersonLoraTrainingPhaseLabel(null, true)).toBe("Weights ready");
	});
});
