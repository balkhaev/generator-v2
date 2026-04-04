import { z } from "zod";

import { jsonValueSchema } from "@/domain/scenarios/scenario-schema";

export const runpodArtifactSchema = z.object({
	kind: z.enum(["image", "video", "log", "json"]),
	url: z.url(),
	fileName: z.string().trim().min(1).optional(),
});

const runpodProviderStatusSchema = z.enum(["queued", "running", "completed", "failed"]);

const runpodSubmitResponseSchema = z.union([
	z.object({
		id: z.string().trim().min(1),
		status: runpodProviderStatusSchema.default("queued"),
	}),
	z.object({
		jobId: z.string().trim().min(1),
		state: runpodProviderStatusSchema,
	}),
]);

const runpodTerminalResultSchema = z.union([
	z.object({
		id: z.string().trim().min(1),
		status: z.literal("completed"),
		output: z.object({
			artifacts: z.array(runpodArtifactSchema),
		}),
	}),
	z.object({
		jobId: z.string().trim().min(1),
		state: z.literal("failed"),
		error: z.object({
			message: z.string().trim().min(1),
			code: z.string().trim().min(1).optional(),
		}),
	}),
]);

export type RunpodDispatchPayload = ReturnType<typeof createRunpodDispatchPayload>;
export type RunpodArtifact = z.infer<typeof runpodArtifactSchema>;

export function createRunpodDispatchPayload(input: {
	workflowKey: string;
	prompt: string;
	inputAssetUrl: string;
	params: Record<string, z.infer<typeof jsonValueSchema>>;
}) {
	return {
		input: {
			workflowKey: input.workflowKey,
			prompt: input.prompt,
			inputAssetUrl: input.inputAssetUrl,
			params: input.params,
		},
	} as const;
}

function mapRunpodStatus(status: z.infer<typeof runpodProviderStatusSchema>) {
	return status === "completed" ? "succeeded" : status;
}

export function normalizeRunpodSubmitResponse(payload: unknown) {
	const parsed = runpodSubmitResponseSchema.parse(payload);

	if ("id" in parsed) {
		return {
			jobId: parsed.id,
			status: mapRunpodStatus(parsed.status),
		} as const;
	}

	return {
		jobId: parsed.jobId,
		status: mapRunpodStatus(parsed.state),
	} as const;
}

export function normalizeRunpodTerminalResult(payload: unknown) {
	const parsed = runpodTerminalResultSchema.parse(payload);

	if ("id" in parsed) {
		return {
			jobId: parsed.id,
			status: "succeeded",
			artifacts: parsed.output.artifacts,
		} as const;
	}

	return {
		jobId: parsed.jobId,
		status: "failed",
		errorSummary: parsed.error.message,
		errorCode: parsed.error.code,
	} as const;
}
