import { getGeneratorCallbackToken } from "@generator/env/server";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";
import { Hono } from "hono";
import { z } from "zod";

import type { StudioService } from "@/domain/studio";

const callbackPayloadSchema = z.object({
	context: z.record(z.string(), z.unknown()),
	execution: z.object({
		artifacts: z.array(z.object({ url: z.string().nullable().optional() })),
		errorSummary: z.string().nullable(),
		id: z.string().min(1),
		inputImageUrl: z.string(),
		providerEndpointId: z.string().nullable(),
		providerJobId: z.string().nullable(),
		status: z.enum(["queued", "running", "succeeded", "failed"]),
		workflowKey: z.string().min(1),
	}),
});

export function createInternalRoutes(service: StudioService) {
	const app = new Hono();

	app.post("/generator-executions", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (token !== getGeneratorCallbackToken()) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const body = await c.req.json();
		const result = callbackPayloadSchema.safeParse(body);
		if (!result.success) {
			return c.json(
				{ error: "Invalid callback payload", issues: result.error.issues },
				400
			);
		}

		const run = await service.applyExecutionCallback(result.data);
		return c.json({ run });
	});

	return app;
}
