import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";
import { Hono } from "hono";

import type { PersonsService } from "@/domain/persons";

const bearerPrefixPattern = /^Bearer\s+/i;

export function createInternalRoutes(service: PersonsService) {
	const app = new Hono();

	app.post("/generator-executions", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (
			token !==
			(process.env.GENERATOR_CALLBACK_TOKEN ?? "local-generator-callback-token")
		) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const payload = (await c.req.json()) as {
			context: Record<string, unknown>;
			execution: GeneratorExecutionRecord;
		};
		const person = await service.applyExecutionCallback(payload);
		return c.json({ person });
	});

	app.post("/lora-trainings", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (
			token !==
			(process.env.TRAINING_CONTROL_TOKEN ?? "local-training-control-token")
		) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const payload = (await c.req.json()) as {
			context: Record<string, unknown>;
			event: unknown;
		};
		const person = await service.applyLoraTrainingEvent(payload);
		return c.json({ person });
	});

	return app;
}
