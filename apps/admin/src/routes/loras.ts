import type {
	CreateLoraFromUrlInput,
	ListLorasQuery,
	LoraBaseModel,
	LoraSourceProvider,
	LoraStatus,
	PreviewLoraSourceInput,
	UpdateLoraInput,
} from "@generator/contracts/loras";
import { LORA_BASE_MODELS } from "@generator/contracts/loras";
import { Hono } from "hono";

import type { LoraRegistryService } from "@/domain/loras";
import { toErrorResponse } from "@/routes/utils";

const LORA_STATUSES: LoraStatus[] = ["active", "archived"];
const LORA_SOURCE_PROVIDERS: LoraSourceProvider[] = [
	"auto",
	"civitai",
	"direct",
	"huggingface",
];

function parseBaseModel(value: string | undefined): LoraBaseModel | undefined {
	if (!value) {
		return;
	}
	return LORA_BASE_MODELS.includes(value as LoraBaseModel)
		? (value as LoraBaseModel)
		: undefined;
}

function parseStatus(value: string | undefined): LoraStatus | undefined {
	if (!value) {
		return;
	}
	return LORA_STATUSES.includes(value as LoraStatus)
		? (value as LoraStatus)
		: undefined;
}

function parseSourceProvider(
	value: string | undefined
): LoraSourceProvider | undefined {
	if (!value) {
		return;
	}
	return LORA_SOURCE_PROVIDERS.includes(value as LoraSourceProvider)
		? (value as LoraSourceProvider)
		: undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: undefined;
}

function resolveListQuery(c: {
	req: { query(key: string): string | undefined };
}): ListLorasQuery {
	return {
		baseModel: parseBaseModel(c.req.query("baseModel")),
		status: parseStatus(c.req.query("status")),
	};
}

function parseCreateBody(body: unknown): CreateLoraFromUrlInput {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	const name = typeof payload.name === "string" ? payload.name : undefined;
	const sourceUrl =
		typeof payload.sourceUrl === "string" ? payload.sourceUrl : "";
	const baseModel = parseBaseModel(
		typeof payload.baseModel === "string" ? payload.baseModel : undefined
	);
	if (!(sourceUrl && baseModel)) {
		throw new Error("sourceUrl and baseModel are required");
	}
	return {
		name,
		sourceUrl,
		baseModel,
		defaultWeight:
			typeof payload.defaultWeight === "number"
				? payload.defaultWeight
				: undefined,
		description:
			typeof payload.description === "string" ? payload.description : undefined,
		sourceFilePath:
			typeof payload.sourceFilePath === "string"
				? payload.sourceFilePath
				: undefined,
		sourceProvider: parseSourceProvider(
			typeof payload.sourceProvider === "string"
				? payload.sourceProvider
				: undefined
		),
		sourceRevision:
			typeof payload.sourceRevision === "string"
				? payload.sourceRevision
				: undefined,
		sourceVersionId: parsePositiveNumber(payload.sourceVersionId),
	};
}

function parsePreviewBody(body: unknown): PreviewLoraSourceInput {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	const sourceUrl =
		typeof payload.sourceUrl === "string" ? payload.sourceUrl : "";
	if (!sourceUrl) {
		throw new Error("sourceUrl is required");
	}
	return {
		sourceFilePath:
			typeof payload.sourceFilePath === "string"
				? payload.sourceFilePath
				: undefined,
		sourceProvider: parseSourceProvider(
			typeof payload.sourceProvider === "string"
				? payload.sourceProvider
				: undefined
		),
		sourceRevision:
			typeof payload.sourceRevision === "string"
				? payload.sourceRevision
				: undefined,
		sourceUrl,
		sourceVersionId: parsePositiveNumber(payload.sourceVersionId),
	};
}

function parseUpdateBody(body: unknown): UpdateLoraInput {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	return {
		name: typeof payload.name === "string" ? payload.name : undefined,
		description:
			typeof payload.description === "string" ? payload.description : undefined,
		baseModel: parseBaseModel(
			typeof payload.baseModel === "string" ? payload.baseModel : undefined
		),
		defaultWeight:
			typeof payload.defaultWeight === "number"
				? payload.defaultWeight
				: undefined,
		status: parseStatus(
			typeof payload.status === "string" ? payload.status : undefined
		),
	};
}

export function createAdminLoraRoutes(service: LoraRegistryService) {
	const app = new Hono();

	app.get("/", async (c) => {
		const loras = await service.listAll(resolveListQuery(c));
		return c.json({ loras });
	});

	app.post("/", async (c) => {
		try {
			const input = parseCreateBody(await c.req.json());
			const entry = await service.createFromUrl(input);
			return c.json({ lora: entry }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/preview", async (c) => {
		try {
			const input = parsePreviewBody(await c.req.json());
			const preview = await service.previewSource(input);
			return c.json({ preview });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.patch("/:id", async (c) => {
		try {
			const patch = parseUpdateBody(await c.req.json());
			const entry = await service.update(c.req.param("id"), patch);
			return entry
				? c.json({ lora: entry })
				: c.json({ error: "LoRA not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:id/archive", async (c) => {
		const entry = await service.archive(c.req.param("id"));
		return entry
			? c.json({ lora: entry })
			: c.json({ error: "LoRA not found" }, 404);
	});

	app.delete("/:id", async (c) => {
		const entry = await service.delete(c.req.param("id"));
		return entry
			? c.json({ lora: entry })
			: c.json({ error: "LoRA not found" }, 404);
	});

	return app;
}

export { resolveListQuery as resolveLoraListQuery };
