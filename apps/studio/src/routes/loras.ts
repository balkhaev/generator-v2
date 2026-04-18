import type { LoraBaseModel } from "@generator/contracts/loras";
import { LORA_BASE_MODELS } from "@generator/contracts/loras";
import type { LoraReadRepository } from "@generator/db/repositories/lora-read";
import { Hono } from "hono";

function parseBaseModel(value: string | undefined): LoraBaseModel | undefined {
	if (!value) {
		return;
	}
	return LORA_BASE_MODELS.includes(value as LoraBaseModel)
		? (value as LoraBaseModel)
		: undefined;
}

export function createLoraRoutes(repository: LoraReadRepository) {
	const app = new Hono();

	app.get("/", async (c) => {
		const baseModel = parseBaseModel(c.req.query("baseModel"));
		try {
			const loras = await repository.list({ baseModel, status: "active" });
			return c.json({ loras });
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "Failed to load LoRAs",
				},
				500
			);
		}
	});

	return app;
}
