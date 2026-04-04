import { describe, expect, it } from "bun:test";

import {
  assertRunStatusTransition,
  createScenarioInputSchema,
  validateScenarioInput,
} from "@/domain/operator";
import { getComfyOperatorEnv } from "@generator/env/server";
import { getWorkflowDefinition } from "@/registry/workflows";

describe("operator domain", () => {
  it("validates scenario workflow params", () => {
    const scenario = validateScenarioInput({
      name: "Operator scenario",
      workflowKey: "ltx-2.3-i2v",
      prompt: "Animate this still image into a short cinematic clip",
      params: {
        steps: 42,
      },
    });

    expect(scenario.params.steps).toBe(42);
    expect(scenario.params.guidanceScale).toBe(7);
  });

  it("rejects unknown workflow keys", () => {
    expect(() =>
      validateScenarioInput({
        name: "Broken",
        workflowKey: "missing",
        prompt: "prompt",
        params: {},
      }),
    ).toThrow("Unknown workflow key");
  });

  it("returns the ltx workflow registry entry", () => {
    const workflow = getWorkflowDefinition("ltx-2.3-i2v");
    expect(workflow?.name).toBe("LTX 2.3 I2V");
    expect(workflow?.parameterFields.length).toBeGreaterThan(0);
  });

  it("prevents invalid run transitions", () => {
    expect(() => assertRunStatusTransition("succeeded", "running")).toThrow(
      "Invalid run status transition",
    );
    expect(() => assertRunStatusTransition("queued", "running")).not.toThrow();
  });

  it("fails clearly when operator env is incomplete", () => {
    expect(() => getComfyOperatorEnv({ RUNPOD_API_KEY: "key" })).toThrow("RUNPOD_ENDPOINT_ID");
  });
});
