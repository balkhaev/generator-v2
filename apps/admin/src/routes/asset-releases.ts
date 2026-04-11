import { Hono } from "hono";

import type { AssetReleaseService } from "@/domain/asset-releases";
import { toErrorResponse } from "@/routes/utils";

const DEFAULT_RELEASE_LIST_LIMIT = 5;

export function createAssetReleaseRoutes(service: AssetReleaseService) {
	const app = new Hono();

	app.get("/", async (c) => {
		const limit = Number(c.req.query("limit") ?? DEFAULT_RELEASE_LIST_LIMIT);
		const releases = await service.listReleases(
			Number.isFinite(limit) ? Math.max(1, Math.min(limit, 20)) : 5
		);
		return c.json({ releases });
	});

	app.post("/", async (c) => {
		try {
			const payload = await c.req.formData();
			const label = String(payload.get("label") ?? "").trim();
			const group = String(payload.get("group") ?? "").trim();
			const files = payload
				.getAll("files")
				.filter((entry): entry is File => entry instanceof File);

			const release = await service.createRelease({
				files,
				group: group as never,
				label,
			});

			return c.json({ release }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.get("/:releaseId", async (c) => {
		const release = await service.getReleaseById(c.req.param("releaseId"));
		return release
			? c.json({ release })
			: c.json({ error: "Asset release not found" }, 404);
	});

	return app;
}
