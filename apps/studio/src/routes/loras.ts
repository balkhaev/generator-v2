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
		const rawBaseModel = c.req.query("baseModel");
		const baseModel = parseBaseModel(rawBaseModel);
		try {
			const loras = await repository.list({ baseModel, status: "active" });
			console.info("studio.loras.list", {
				rawBaseModel,
				parsedBaseModel: baseModel,
				count: loras.length,
				slugs: loras.map((entry) => entry.slug),
			});
			return c.json({ loras });
		} catch (error) {
			console.error("studio.loras.error", {
				rawBaseModel,
				parsedBaseModel: baseModel,
				error: error instanceof Error ? error.message : String(error),
			});
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
