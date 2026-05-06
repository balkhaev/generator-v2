import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

import type {
	RunpodServerlessApi,
	ServerlessJobStatus,
	ServerlessSubmission,
} from "../api/serverless";
import type { ServerlessWorkflow } from "../workflow/definition";
import { createServerlessEngine } from "./serverless-engine";

interface FooocusOutput {
	images: Array<{ url?: string; dataUrl?: string }>;
}

const fooocusInputSchema = z.object({
	prompt: z.string(),
	negativePrompt: z.string().optional(),
});

const fooocusWorkflow: ServerlessWorkflow<
	z.infer<typeof fooocusInputSchema>,
	FooocusOutput
> = {
	id: "fooocus-sdxl",
	mode: "serverless",
	endpointId: "endpoint-x",
	inputSchema: fooocusInputSchema,
	buildPayload(input) {
		return { prompt: input.prompt, api_name: "txt2img" };
	},
	parseOutput(raw) {
		if (!Array.isArray(raw)) {
			throw new Error("expected array output");
		}
		const items = raw as Record<string, unknown>[];
		return {
			images: items.map((item) => ({
				url: typeof item.url === "string" ? item.url : undefined,
				dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : undefined,
			})),
		};
	},
};

function buildApi(
	overrides: Partial<RunpodServerlessApi> = {}
): RunpodServerlessApi {
	return {
		cancel: overrides.cancel ?? mock(() => Promise.resolve()),
		getStatus:
			overrides.getStatus ??
			mock(() =>
				Promise.resolve<ServerlessJobStatus>({
					error: null,
					jobId: "job-1",
					output: null,
					queuePosition: null,
					rawStatus: "IN_QUEUE",
				})
			),
		submit:
			overrides.submit ??
			mock(() =>
				Promise.resolve<ServerlessSubmission>({
					jobId: "job-1",
					queuePosition: null,
					rawStatus: "IN_QUEUE",
				})
			),
	};
}

describe("ServerlessEngine", () => {
	it("validates input, calls api with built payload and policy", async () => {
		const submit = mock(() =>
			Promise.resolve<ServerlessSubmission>({
				jobId: "job-9",
				queuePosition: 2,
				rawStatus: "IN_QUEUE",
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ submit }),
			workflow: { ...fooocusWorkflow, policy: { ttl: 60 } },
		});

		const result = await engine.submit({ prompt: "hi" });

		expect(submit).toHaveBeenCalledWith({
			endpointId: "endpoint-x",
			input: { prompt: "hi", api_name: "txt2img" },
			policy: { ttl: 60 },
		});
		expect(result).toEqual({
			jobId: "job-9",
			queuePosition: 2,
			status: "queued",
		});
	});

	it("rejects malformed input via the workflow schema", async () => {
		const engine = createServerlessEngine({
			api: buildApi(),
			workflow: fooocusWorkflow,
		});
		await expect(engine.submit({} as never)).rejects.toThrow();
	});

	it("normalizes COMPLETED into succeeded and runs parseOutput", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				error: null,
				jobId: "job-1",
				output: [{ url: "https://x/y.png" }],
				queuePosition: null,
				rawStatus: "COMPLETED",
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.status).toBe("succeeded");
		expect(job.progressPct).toBe(100);
		expect(job.output).toEqual({
			images: [{ url: "https://x/y.png", dataUrl: undefined }],
		});
	});

	it("converts base64 outputs into data URLs before parseOutput", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				error: null,
				jobId: "job-1",
				output: [{ base64: "iVBORw0KGgo=" }],
				queuePosition: null,
				rawStatus: "COMPLETED",
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.output?.images[0]?.dataUrl).toBe(
			"data:image/png;base64,iVBORw0KGgo="
		);
	});

	it("treats top-level errors as failed and extracts message", async () => {
		const getStatus = mock(() =>
			Promise.resolve<ServerlessJobStatus>({
				error: { message: "lora missing" },
				jobId: "job-1",
				output: null,
				queuePosition: null,
				rawStatus: "FAILED",
			})
		);
		const engine = createServerlessEngine({
			api: buildApi({ getStatus }),
			workflow: fooocusWorkflow,
		});

		const job = await engine.getStatus("job-1");
		expect(job.status).toBe("failed");
		expect(job.errorSummary).toBe("lora missing");
		expect(job.output).toBeNull();
	});

	it("delegates cancel to the api", async () => {
		const cancel = mock(() => Promise.resolve());
		const engine = createServerlessEngine({
			api: buildApi({ cancel }),
			workflow: fooocusWorkflow,
		});
		await engine.cancel("job-1");
		expect(cancel).toHaveBeenCalledWith({
			endpointId: "endpoint-x",
			jobId: "job-1",
		});
	});
});
