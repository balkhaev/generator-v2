import { Hono } from "hono";
import { z } from "zod";

import type { PersonsService } from "@/domain/persons";
import {
	AdorelyDebugMcpClient,
	importAdorelyCompanions,
} from "@/importers/adorely";

const adorelyImportSchema = z.object({
	mode: z
		.enum(["preview", "import", "import-and-start-training"])
		.default("preview"),
	targetDatasetCount: z.number().int().min(1).max(100).optional(),
});

function resolveAdorelyMcpToken() {
	return (
		process.env.ADORELY_DEBUG_MCP_TOKEN?.trim() ||
		process.env.ADORELY_INTERNAL_API_TOKEN?.trim() ||
		null
	);
}

export function createIntegrationRoutes(service: PersonsService) {
	const app = new Hono();

	app.get("/server", async (c) => {
		return c.json(await service.getServerHealth());
	});

	app.post("/adorely-import", async (c) => {
		const token = resolveAdorelyMcpToken();
		if (!token) {
			return c.json(
				{
					error:
						"Adorely MCP token is not configured. Set ADORELY_DEBUG_MCP_TOKEN on persons-api.",
				},
				503
			);
		}

		try {
			const body = adorelyImportSchema.parse(
				await c.req.json().catch(() => ({}))
			);
			const dryRun = body.mode === "preview";
			const summary = await importAdorelyCompanions(
				new AdorelyDebugMcpClient({
					token,
					...(process.env.ADORELY_DEBUG_MCP_URL
						? { url: process.env.ADORELY_DEBUG_MCP_URL }
						: {}),
				}),
				{
					dryRun,
					riskLevel: 2,
					service,
					startTraining: body.mode === "import-and-start-training",
					status: "active",
					...(body.targetDatasetCount
						? { targetDatasetCount: body.targetDatasetCount }
						: {}),
				}
			);

			return c.json(
				{
					filter: {
						riskLevel: 2,
						status: "active",
					},
					summary,
				},
				dryRun ? 200 : 202
			);
		} catch (error) {
			const responseStatus = error instanceof z.ZodError ? 400 : 500;
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Unable to run Adorely import.",
				},
				responseStatus
			);
		}
	});

	return app;
}
