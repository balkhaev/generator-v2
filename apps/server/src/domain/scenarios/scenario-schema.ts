import { z } from "zod";

export const jsonValueSchema: z.ZodType<
	string | number | boolean | null | { [key: string]: unknown } | unknown[]
> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

export const scenarioInputImageSchema = z.object({
	assetUrl: z.url(),
	filename: z.string().trim().min(1).max(255),
	mimeType: z.string().trim().min(1).max(128),
});

export function createScenarioDraftSchema<const TWorkflowKeys extends readonly [string, ...string[]]>(
	allowedWorkflowKeys: TWorkflowKeys,
) {
	return z.object({
		name: z.string().trim().min(1).max(120),
		workflowKey: z.enum(allowedWorkflowKeys),
		prompt: z.string().trim().min(1).max(4000),
		params: z.record(z.string(), jsonValueSchema),
	});
}

export const scenarioRunDraftSchema = z.object({
	scenarioId: z.string().trim().min(1),
	inputImage: scenarioInputImageSchema,
});

export type ScenarioDraft = z.infer<ReturnType<typeof createScenarioDraftSchema>>;
export type ScenarioRunDraft = z.infer<typeof scenarioRunDraftSchema>;
