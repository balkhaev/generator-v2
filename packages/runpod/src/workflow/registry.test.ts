import { describe, expect, it } from "bun:test";
import { z } from "zod";

import type { PodWorkflow, ServerlessWorkflow } from "./definition";
import { createWorkflowRegistry, UnknownWorkflowError } from "./registry";

const serverlessWf: ServerlessWorkflow<unknown, unknown> = {
	id: "fooocus-sdxl",
	mode: "serverless",
	endpointId: "endpoint-x",
	inputSchema: z.unknown() as z.ZodType<unknown>,
	buildPayload: () => ({}),
	parseOutput: (raw) => raw,
};

const podWf: PodWorkflow<unknown, unknown> = {
	id: "ltx-2-3-video",
	mode: "pod",
	pod: {
		imageName: "img:latest",
		networkVolumes: [
			{
				gpuTypeIds: ["A6000"],
				label: "test-dc",
				networkVolumeId: "vol-test",
			},
		],
		templateId: "tpl-x",
	},
	inputSchema: z.unknown() as z.ZodType<unknown>,
	artifactContentType: "video/mp4",
	buildPrompt: () => ({ prompt: {} }),
	parseOutput: () => ({}),
};

describe("WorkflowRegistry", () => {
	it("indexes workflows by id and validates uniqueness", () => {
		const registry = createWorkflowRegistry([serverlessWf, podWf]);
		expect(registry.has("fooocus-sdxl")).toBe(true);
		expect(registry.has("missing")).toBe(false);
		expect(registry.list()).toHaveLength(2);
		expect(registry.get("ltx-2-3-video").id).toBe("ltx-2-3-video");
	});

	it("rejects duplicate ids", () => {
		expect(() => createWorkflowRegistry([serverlessWf, serverlessWf])).toThrow(
			"Duplicate RunPod workflow id"
		);
	});

	it("rejects ids containing the colon separator", () => {
		expect(() =>
			createWorkflowRegistry([{ ...serverlessWf, id: "bad:id" }])
		).toThrow("not contain ':'");
	});

	it("rejects pod workflows without network volumes, gpu types, image, or templateId", () => {
		expect(() =>
			createWorkflowRegistry([
				{
					...podWf,
					pod: { ...podWf.pod, networkVolumes: [] },
				},
			])
		).toThrow("at least one networkVolume");
		expect(() =>
			createWorkflowRegistry([
				{
					...podWf,
					pod: {
						...podWf.pod,
						networkVolumes: [
							{
								gpuTypeIds: [],
								label: "test-dc",
								networkVolumeId: "vol-test",
							},
						],
					},
				},
			])
		).toThrow("no gpuTypeIds");
		expect(() =>
			createWorkflowRegistry([
				{
					...podWf,
					pod: { ...podWf.pod, imageName: "" },
				},
			])
		).toThrow("imageName");
		expect(() =>
			createWorkflowRegistry([
				{
					...podWf,
					pod: { ...podWf.pod, templateId: undefined },
				},
			])
		).toThrow("templateId");
	});

	it("throws UnknownWorkflowError on missing id", () => {
		const registry = createWorkflowRegistry([serverlessWf]);
		expect(() => registry.get("missing")).toThrow(UnknownWorkflowError);
	});
});
