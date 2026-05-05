import type { LoraBaseModel } from "@generator/contracts/loras";
import { LORA_BASE_MODELS } from "@generator/contracts/loras";
import type { LoraReadRepository } from "@generator/db/repositories/lora-read";
import { normalizeBaseUrl } from "@generator/http/shared";
import { Hono } from "hono";

function parseBaseModel(value: string | undefined): LoraBaseModel | undefined {
	if (!value) {
		return;
	}
	return LORA_BASE_MODELS.includes(value as LoraBaseModel)
		? (value as LoraBaseModel)
		: undefined;
}

interface LoraRoutesOptions {
	adminApiBaseUrl?: string;
	adminInternalToken?: string;
	fetchImpl?: (
		input: string | URL | Request,
		init?: RequestInit
	) => Promise<Response>;
}

function getJsonErrorMessage(payload: unknown): string | null {
	if (
		payload &&
		typeof payload === "object" &&
		typeof (payload as { error?: unknown }).error === "string"
	) {
		return (payload as { error: string }).error;
	}
	return null;
}

async function readUpstreamError(response: Response): Promise<string> {
	try {
		const payload = (await response.json()) as unknown;
		const message = getJsonErrorMessage(payload);
		if (message) {
			return message;
		}
	} catch {
		// Fall through to text/status below.
	}

	try {
		const text = await response.text();
		if (text) {
			return text;
		}
	} catch {
		// Fall through to status below.
	}

	return `${response.status} ${response.statusText}`.trim();
}

async function proxyAdminLoraRequest(
	path: "/api/admin/loras" | "/api/admin/loras/preview",
	body: unknown,
	options: LoraRoutesOptions
): Promise<{ body: unknown; status: number }> {
	const adminApiBaseUrl = options.adminApiBaseUrl?.trim();
	const adminInternalToken = options.adminInternalToken?.trim();

	if (!(adminApiBaseUrl && adminInternalToken)) {
		return {
			body: {
				error:
					"Admin API is not configured for Studio LoRA imports. Set ADMIN_API_URL and TRAINING_CONTROL_TOKEN.",
			},
			status: 503,
		};
	}

	const response = await (options.fetchImpl ?? fetch)(
		`${normalizeBaseUrl(adminApiBaseUrl)}${path}`,
		{
			body: JSON.stringify(body),
			headers: {
				authorization: `Bearer ${adminInternalToken}`,
				"content-type": "application/json",
			},
			method: "POST",
		}
	);

	if (!response.ok) {
		return {
			body: { error: await readUpstreamError(response) },
			status: response.status,
		};
	}

	return {
		body: (await response.json()) as unknown,
		status: response.status,
	};
}

export function createLoraRoutes(
	repository: LoraReadRepository,
	options: LoraRoutesOptions = {}
) {
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

	app.post("/preview", async (c) => {
		const result = await proxyAdminLoraRequest(
			"/api/admin/loras/preview",
			await c.req.json(),
			options
		);
		return c.json(result.body, result.status as 200);
	});

	app.post("/import", async (c) => {
		const result = await proxyAdminLoraRequest(
			"/api/admin/loras",
			await c.req.json(),
			options
		);
		return c.json(result.body, result.status as 200);
	});

	return app;
}
