import { Hono } from "hono";

import type { AssetReleasePresetService } from "@/domain/asset-release-presets";
import { toErrorResponse } from "@/routes/utils";

export function createAssetReleasePresetRoutes(
	service: AssetReleasePresetService
) {
	const app = new Hono();

	app.get("/", (c) => c.json({ presets: service.listPresets() }));

	app.post("/:presetId/provision", async (c) => {
		try {
			const result = await service.provisionPreset(c.req.param("presetId"));
			return c.json(result, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	return app;
}
