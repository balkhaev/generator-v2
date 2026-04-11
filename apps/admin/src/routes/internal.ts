import { Hono } from "hono";

import type { PersonLoraTrainingControl } from "@/domain/person-lora-training-control";

export function createInternalRoutes(service: PersonLoraTrainingControl) {
	const app = new Hono();

	app.post("/person-lora-trainings", async (c) => {
		const token = c.req.header("authorization")?.replace(/^Bearer\s+/iu, "");
		if (
			token !==
			(process.env.TRAINING_CONTROL_TOKEN ?? "local-training-control-token")
		) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		try {
			const payload = await c.req.json();
			return c.json(await service.enqueue(payload), 202);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Unable to enqueue training job.",
				},
				400
			);
		}
	});

	return app;
}
