import {
	listAssetReleasePresets,
	toAssetReleasePresetSummary,
} from "@generator/asset-release-presets";
import { Hono } from "hono";

export function createAssetReleasePresetRoutes() {
	const app = new Hono();

	app.get("/", (c) => {
		return c.json({
			presets: listAssetReleasePresets().map(toAssetReleasePresetSummary),
		});
	});

	return app;
}
