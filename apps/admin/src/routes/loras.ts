import type {
	CreateLoraFromUrlInput,
	ListLorasQuery,
	LoraBaseModel,
	LoraSourceProvider,
	LoraStatus,
	LoraVariant,
	PreviewLoraSourceInput,
	UpdateLoraInput,
} from "@generator/contracts/loras";
import { LORA_BASE_MODELS, LORA_VARIANTS } from "@generator/contracts/loras";
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

function parseVariant(value: unknown): LoraVariant | undefined {
	if (typeof value !== "string") {
		return;
	}
	return LORA_VARIANTS.includes(value as LoraVariant)
		? (value as LoraVariant)
		: undefined;
}

function parseTriggerWords(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return;
	}
	const words = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return words;
}

function parsePair(value: unknown): CreateLoraFromUrlInput["pair"] | undefined {
	if (!value || typeof value !== "object") {
		return;
	}
	const payload = value as Record<string, unknown>;
	const sourceUrl =
		typeof payload.sourceUrl === "string" ? payload.sourceUrl : "";
	const variant = parseVariant(payload.variant);
	if (!(sourceUrl && (variant === "high" || variant === "low"))) {
		throw new Error(
			"pair.sourceUrl and pair.variant ('high' | 'low') are required"
		);
	}
	return {
		defaultWeight:
			typeof payload.defaultWeight === "number"
				? payload.defaultWeight
				: undefined,
		description:
			typeof payload.description === "string" ? payload.description : undefined,
		name: typeof payload.name === "string" ? payload.name : undefined,
		sourceFilePath:
			typeof payload.sourceFilePath === "string"
				? payload.sourceFilePath
				: undefined,
		sourceUrl,
		sourceVersionId: parsePositiveNumber(payload.sourceVersionId),
		triggerWords: parseTriggerWords(payload.triggerWords),
		variant,
	};
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
		triggerWords: parseTriggerWords(payload.triggerWords),
		variant: parseVariant(payload.variant),
		pair: parsePair(payload.pair),
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
	let variant: LoraVariant | null | undefined;
	if (payload.variant === null) {
		variant = null;
	} else if (typeof payload.variant === "string") {
		variant = parseVariant(payload.variant) ?? undefined;
	}
	let pairGroupId: string | null | undefined;
	if (payload.pairGroupId === null) {
		pairGroupId = null;
	} else if (typeof payload.pairGroupId === "string") {
		pairGroupId = payload.pairGroupId;
	}
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
		triggerWords: parseTriggerWords(payload.triggerWords),
		variant,
		pairGroupId,
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
			const result = await service.createFromUrl(input);
			if (Array.isArray(result)) {
				return c.json({ loras: result }, 201);
			}
			return c.json({ lora: result }, 201);
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
