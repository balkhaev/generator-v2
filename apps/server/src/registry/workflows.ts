import { z } from "zod";

const ltx23I2VParamsSchema = z.object({
	negativePrompt: z.string().default(""),
	steps: z.number().int().min(1).max(80).default(30),
	guidanceScale: z.number().min(1).max(20).default(7),
	seed: z.number().int().nonnegative().optional(),
	frameRate: z.number().int().min(1).max(60).default(24),
	motionBucket: z.number().int().min(1).max(255).default(127),
	numFrames: z.number().int().min(1).max(240).default(97),
});

export type WorkflowField = {
	readonly key: string;
	readonly label: string;
	readonly type: "text" | "number";
	readonly description: string;
};

export type WorkflowDefinition<TParams extends z.ZodTypeAny = z.ZodTypeAny> = {
	readonly key: string;
	readonly name: string;
	readonly description: string;
	readonly parameterSchema: TParams;
	readonly parameterFields: readonly WorkflowField[];
	buildRunpodInput: (args: {
		prompt: string;
		params: z.infer<TParams>;
		inputImageUrl: string;
	}) => Record<string, unknown>;
	extractArtifactUrls: (output: unknown) => string[];
};

export const workflowRegistry = {
	"ltx-2.3-i2v": {
		key: "ltx-2.3-i2v",
		name: "LTX 2.3 I2V",
		description:
			"Internal image-to-video operator flow backed by a Runpod serverless ComfyUI worker.",
		parameterSchema: ltx23I2VParamsSchema,
		parameterFields: [
			{
				key: "negativePrompt",
				label: "Negative prompt",
				type: "text",
				description: "Optional negative prompt forwarded to the workflow.",
			},
			{
				key: "steps",
				label: "Steps",
				type: "number",
				description: "Inference steps for the workflow.",
			},
			{
				key: "guidanceScale",
				label: "Guidance scale",
				type: "number",
				description: "Prompt guidance scale.",
			},
			{
				key: "seed",
				label: "Seed",
				type: "number",
				description: "Optional deterministic seed.",
			},
			{
				key: "frameRate",
				label: "Frame rate",
				type: "number",
				description: "Frames per second for the generated output.",
			},
			{
				key: "motionBucket",
				label: "Motion bucket",
				type: "number",
				description: "ComfyUI motion bucket strength.",
			},
			{
				key: "numFrames",
				label: "Frame count",
				type: "number",
				description: "Target number of frames to render.",
			},
		],
		buildRunpodInput: ({ prompt, params, inputImageUrl }) => ({
			workflow: "ltx-2.3-i2v",
			prompt,
			inputImageUrl,
			parameters: params,
		}),
		extractArtifactUrls: (output) => {
			const looksLikeArtifactUrl = (value: string) => {
				return (
					value.startsWith("http://") ||
					value.startsWith("https://") ||
					/(^|\/)[^\s]+\.(png|jpe?g|webp|gif|mp4|mov|webm)(\?.*)?$/i.test(value)
				);
			};

			const collect = (value: unknown): string[] => {
				if (!value) {
					return [];
				}
				if (typeof value === "string") {
					return looksLikeArtifactUrl(value) ? [value] : [];
				}
				if (Array.isArray(value)) {
					return value.flatMap(collect);
				}
				if (typeof value === "object") {
					const record = value as Record<string, unknown>;
					const directKeys = ["video", "videoUrl", "image", "imageUrl", "url"];
					const urls = directKeys.flatMap((key) => collect(record[key]));
					return urls.length > 0
						? urls
						: Object.values(record).flatMap(collect);
				}
				return [];
			};

			return [...new Set(collect(output))];
		},
	},
} satisfies Record<string, WorkflowDefinition>;

export type WorkflowKey = keyof typeof workflowRegistry;
export type WorkflowRegistry = typeof workflowRegistry;
export type WorkflowSummary = {
	key: string;
	name: string;
	description: string;
	parameterFields: readonly WorkflowField[];
	defaults: Record<string, unknown>;
};

export function listWorkflows(): WorkflowSummary[] {
	return Object.values(workflowRegistry).map((workflow) => ({
		key: workflow.key,
		name: workflow.name,
		description: workflow.description,
		parameterFields: workflow.parameterFields,
		defaults: workflow.parameterSchema.parse({}) as Record<string, unknown>,
	}));
}

export function getWorkflowDefinition(workflowKey: string) {
	return workflowRegistry[workflowKey as WorkflowKey] ?? null;
}
