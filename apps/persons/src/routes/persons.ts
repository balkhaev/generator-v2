import { Hono } from "hono";

import type { PersonsService } from "@/domain/persons";
import { toErrorResponse } from "@/routes/utils";

export function createPersonRoutes(service: PersonsService) {
	const app = new Hono<{
		Variables: {
			debugCorrelationId: string;
		};
	}>();

	app.get("/", async (c) => {
		return c.json({ persons: await service.listPersons() });
	});

	app.post("/", async (c) => {
		try {
			const payload = await c.req.json();
			const person = await service.createPerson(payload);
			return c.json({ person }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/from-prompt", async (c) => {
		try {
			const payload = await c.req.json();
			const person = await service.createPersonFromPrompt(payload);
			return c.json({ person }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/avatar-previews", async (c) => {
		try {
			const payload = await c.req.json();
			const batch = await service.requestAvatarPreviews(payload, {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return c.json(
				{
					batch,
					execution: batch.executions[0],
				},
				201
			);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/avatar-previews/refine", async (c) => {
		try {
			const payload = await c.req.json();
			const batch = await service.refineAvatarPreviews(payload, {
				debugCorrelationId: c.get("debugCorrelationId"),
			});
			return c.json(
				{
					batch,
					execution: batch.executions[0],
				},
				201
			);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.get("/avatar-previews/:executionId", async (c) => {
		try {
			const execution = await service.getAvatarPreview(
				c.req.param("executionId"),
				{
					debugCorrelationId: c.get("debugCorrelationId"),
				}
			);
			return c.json({ execution });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.get("/:personId", async (c) => {
		const person = await service.getPersonById(c.req.param("personId"));
		if (!person) {
			return c.json({ error: "Person not found" }, 404);
		}

		return c.json({ person });
	});

	app.get("/lookup/run/:operatorRunId", async (c) => {
		const person = await service.findPersonByOperatorRunId(
			c.req.param("operatorRunId")
		);
		if (!person) {
			return c.json({ error: "Person not found" }, 404);
		}

		return c.json({ person });
	});

	app.patch("/:personId", async (c) => {
		try {
			const payload = await c.req.json();
			const person = await service.updatePerson(
				c.req.param("personId"),
				payload
			);
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ person });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.delete("/:personId", async (c) => {
		const deleted = await service.deletePerson(c.req.param("personId"));
		return deleted
			? c.body(null, 204)
			: c.json({ error: "Person not found" }, 404);
	});

	app.delete("/:personId/generations/:generationId", async (c) => {
		const person = await service.deleteGeneration(
			c.req.param("personId"),
			c.req.param("generationId")
		);
		if (!person) {
			return c.json({ error: "Generation not found" }, 404);
		}

		return c.json({ person });
	});

	app.post("/:personId/generations/:generationId/cancel", async (c) => {
		try {
			const person = await service.cancelGeneration(
				c.req.param("personId"),
				c.req.param("generationId")
			);
			if (!person) {
				return c.json({ error: "Generation not found" }, 404);
			}

			return c.json({ person });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:personId/generations", async (c) => {
		try {
			const generation = await service.createGeneration(
				c.req.param("personId"),
				await c.req.json()
			);
			if (!generation) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ generation }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:personId/generations/import", async (c) => {
		try {
			const generation = await service.importGenerationFromServer(
				c.req.param("personId"),
				await c.req.json()
			);
			if (!generation) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ generation }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:personId/train-lora", async (c) => {
		try {
			const person = await service.startLoraTraining(
				c.req.param("personId"),
				await c.req.json(),
				{
					debugCorrelationId: c.get("debugCorrelationId"),
				}
			);
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ person }, 202);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:personId/train-lora/confirm", async (c) => {
		try {
			const person = await service.confirmDatasetAndStartTraining(
				c.req.param("personId"),
				{
					debugCorrelationId: c.get("debugCorrelationId"),
				}
			);
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ person }, 202);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:personId/train-lora/cancel", async (c) => {
		try {
			const person = await service.cancelLoraTraining(c.req.param("personId"));
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ person });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:personId/generate-with-lora", async (c) => {
		try {
			const body = await c.req.json<{
				enhance?: boolean;
				extraLoraUrl?: string;
				extraLoraWeight?: number;
				prompt?: string;
			}>();
			const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
			if (!prompt) {
				return c.json({ error: "prompt is required" }, 400);
			}
			const person = await service.generateWithLora(
				c.req.param("personId"),
				prompt,
				{
					enhance: body.enhance === true,
					extraLoraUrl:
						typeof body.extraLoraUrl === "string"
							? body.extraLoraUrl.trim()
							: undefined,
					extraLoraWeight:
						typeof body.extraLoraWeight === "number"
							? body.extraLoraWeight
							: undefined,
				}
			);
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ person }, 202);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:personId/speak", async (c) => {
		try {
			const body = await c.req.json<{
				text?: string;
				engine?: string;
				referenceVoiceUrl?: string;
				referenceText?: string;
				style?: string;
				language?: string;
				emotion?: string;
			}>();
			const text = typeof body.text === "string" ? body.text.trim() : "";
			if (!text) {
				return c.json({ error: "text is required" }, 400);
			}
			const engine = body.engine === "higgs" ? "higgs" : "voxcpm";
			const trimmedOrUndefined = (value: unknown) =>
				typeof value === "string" && value.trim().length > 0
					? value.trim()
					: undefined;
			const person = await service.generateVoice(
				c.req.param("personId"),
				text,
				{
					engine,
					referenceVoiceUrl: trimmedOrUndefined(body.referenceVoiceUrl),
					referenceText: trimmedOrUndefined(body.referenceText),
					style: trimmedOrUndefined(body.style),
					language: trimmedOrUndefined(body.language),
					emotion: trimmedOrUndefined(body.emotion),
				}
			);
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}

			return c.json({ person }, 202);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	return app;
}
