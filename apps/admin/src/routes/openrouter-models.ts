import { Hono } from "hono";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

interface OpenRouterModelsPayload {
	data?: Array<{ id?: string; name?: string }>;
}

export function createOpenRouterModelsRoutes(deps: {
	fetchImpl?: typeof fetch;
	openRouterApiKey?: string | null;
}) {
	const app = new Hono();
	const fetchImpl = deps.fetchImpl ?? fetch;

	app.get("/", async (c) => {
		const headers: Record<string, string> = {
			accept: "application/json",
		};
		const key = deps.openRouterApiKey?.trim();
		if (key) {
			headers.authorization = `Bearer ${key}`;
		}

		let response: Response;
		try {
			response = await fetchImpl(OPENROUTER_MODELS_URL, {
				headers,
				method: "GET",
			});
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Failed to reach OpenRouter",
				},
				502
			);
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			return c.json(
				{
					error: `OpenRouter models: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
				},
				502
			);
		}

		const json = (await response.json()) as OpenRouterModelsPayload;
		const raw = Array.isArray(json.data) ? json.data : [];
		const models = raw
			.filter((m): m is { id: string; name: string } => Boolean(m?.id))
			.map((m) => ({
				id: m.id as string,
				name: (m.name ?? m.id) as string,
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, 1000);

		return c.json({ models });
	});

	return app;
}
