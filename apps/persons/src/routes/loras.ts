import type { LoraBaseModel } from "@generator/contracts/loras";
import { LORA_BASE_MODELS } from "@generator/contracts/loras";
import { Hono } from "hono";

import type { AdminLoraClient } from "@/clients/admin-loras";

function parseBaseModel(value: string | undefined): LoraBaseModel | undefined {
	if (!value) {
		return;
	}
	return LORA_BASE_MODELS.includes(value as LoraBaseModel)
		? (value as LoraBaseModel)
		: undefined;
}

export function createLoraRoutes(client: AdminLoraClient) {
	const app = new Hono();

	app.get("/", async (c) => {
		const baseModel = parseBaseModel(c.req.query("baseModel"));
		try {
			const loras = await client.listLoras({ baseModel });
			return c.json({ loras });
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "Failed to load LoRAs",
				},
				502
			);
		}
	});

	return app;
}
