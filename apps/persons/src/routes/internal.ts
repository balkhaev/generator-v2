import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import { env } from "@generator/env/server";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";
import { Hono } from "hono";

import type { PersonsService } from "@/domain/persons";

const bearerPrefixPattern = /^Bearer\s+/i;

export function createInternalRoutes(service: PersonsService) {
	const app = new Hono();

	const isAuthorized = (token: string | undefined) =>
		token === env.TRAINING_CONTROL_TOKEN;

	app.post("/generator-executions", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (token !== env.GENERATOR_CALLBACK_TOKEN) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const payload = (await c.req.json()) as {
			context: Record<string, unknown>;
			execution: GeneratorExecutionRecord;
		};
		const person = await service.applyExecutionCallback(payload);
		return c.json({ person });
	});

	app.get("/persons", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		return c.json({ persons: await service.listPersons() });
	});

	app.post("/persons/:personId/retrain-lora", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		try {
			const body = (await c.req.json().catch(() => ({}))) as {
				outputName?: string;
				referencePrompt?: string;
				triggerWord?: string;
			};
			const person = await service.startLoraTraining(c.req.param("personId"), {
				outputName: body.outputName,
				referencePrompt: body.referencePrompt,
				triggerWord: body.triggerWord,
			});
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}
			return c.json({ person }, 202);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Unable to enqueue retraining job.",
				},
				400
			);
		}
	});

	app.post("/lora-trainings", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
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
