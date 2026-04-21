import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import { env } from "@generator/env/server";
import { GENERATOR_CALLBACK_TOKEN_HEADER } from "@generator/http/shared";
import { Hono } from "hono";
import { z } from "zod";

import type {
	AdorelyAssetRepairSource,
	PersonGenerationRecord,
	PersonRecord,
	PersonsService,
} from "@/domain/persons";
import {
	type AdorelyCompanionAsset,
	AdorelyDebugMcpClient,
	getAdorelyAssetVariantId,
	listAllAdorelyCompanionAssets,
	selectAdorelyReferenceAssets,
} from "@/importers/adorely";

const bearerPrefixPattern = /^Bearer\s+/i;
const adorelyObjectStoragePath = "/adorely/";
const reuploadAdorelyAssetsSchema = z.object({
	apply: z.boolean().default(false),
	companionId: z.string().trim().min(1).optional(),
	targetImportedAssetCount: z.number().int().min(1).max(50).optional(),
});
type ReuploadAdorelyAssetsBody = z.infer<typeof reuploadAdorelyAssetsSchema>;

class InternalRouteError extends Error {
	readonly status: 400 | 404 | 503;

	constructor(status: 400 | 404 | 503, message: string) {
		super(message);
		this.status = status;
	}
}

function resolveAdorelyMcpToken() {
	return (
		process.env.ADORELY_DEBUG_MCP_TOKEN?.trim() ||
		process.env.ADORELY_INTERNAL_API_TOKEN?.trim() ||
		null
	);
}

function readMetadataString(
	metadata: Record<string, unknown>,
	key: string
): string | null {
	const value = metadata[key];
	return typeof value === "string" ? value : null;
}

function readMetadataNumber(
	metadata: Record<string, unknown>,
	key: string
): number | null {
	const value = metadata[key];
	return typeof value === "number" ? value : null;
}

function readImportedAdorelyId(person: PersonRecord) {
	const imports = person.metadata.imports;
	if (!(imports && typeof imports === "object" && !Array.isArray(imports))) {
		return null;
	}
	const adorely = (imports as Record<string, unknown>).adorely;
	if (!(adorely && typeof adorely === "object" && !Array.isArray(adorely))) {
		return null;
	}
	return readMetadataString(adorely as Record<string, unknown>, "id");
}

function isAdorelyDatasetGeneration(generation: PersonGenerationRecord) {
	return (
		generation.metadata.isDatasetPhoto === true &&
		(readMetadataString(generation.metadata, "datasetImportedFrom") ===
			"adorely" ||
			readMetadataString(generation.metadata, "adorelyAssetId") !== null ||
			generation.sourceUrl.includes(adorelyObjectStoragePath))
	);
}

function getAdorelyDatasetOrder(generation: PersonGenerationRecord) {
	return readMetadataNumber(generation.metadata, "datasetOrder") ?? 0;
}

function toRepairAsset(asset: AdorelyCompanionAsset): AdorelyAssetRepairSource {
	return {
		assetId: asset.assetId,
		assetRef: asset.assetRef,
		assetSource: asset.source,
		assetSourceTable: asset.assetSourceTable,
		caption: asset.caption,
		kind: asset.kind,
		order: asset.order,
		url: asset.url,
		variantId: getAdorelyAssetVariantId(asset),
	};
}

function buildAdorelyRepairItems(input: {
	assets: AdorelyCompanionAsset[];
	rows: PersonGenerationRecord[];
	targetCount: number;
}) {
	const assetById = new Map(
		input.assets.map((asset) => [asset.assetId, asset])
	);
	const reservedAssetIds = new Set(
		input.rows
			.map((row) => readMetadataString(row.metadata, "adorelyAssetId"))
			.filter((assetId): assetId is string =>
				assetId ? assetById.has(assetId) : false
			)
	);
	const usedAssetIds = new Set<string>();
	const fallbackAssets = input.assets[Symbol.iterator]();

	return input.rows.slice(0, input.targetCount).map((row, index) => {
		const currentAssetId = readMetadataString(row.metadata, "adorelyAssetId");
		const matchedAsset = currentAssetId
			? assetById.get(currentAssetId)
			: undefined;
		let asset =
			matchedAsset && !usedAssetIds.has(matchedAsset.assetId)
				? matchedAsset
				: undefined;

		while (!asset) {
			const next = fallbackAssets.next();
			if (next.done) {
				throw new Error("Not enough Adorely image assets for repair");
			}
			if (
				!(
					usedAssetIds.has(next.value.assetId) ||
					reservedAssetIds.has(next.value.assetId)
				)
			) {
				asset = next.value;
			}
		}

		usedAssetIds.add(asset.assetId);
		return {
			asset: toRepairAsset(asset),
			datasetOrder: getAdorelyDatasetOrder(row) ?? index,
			generationId: row.id,
			previousAssetId: currentAssetId,
			previousUrl: row.sourceUrl,
		};
	});
}

async function buildAdorelyRepairPlan(input: {
	body: ReuploadAdorelyAssetsBody;
	mcpToken: string;
	personId: string;
	service: PersonsService;
}) {
	const person = await input.service.getPersonById(input.personId);
	if (!person) {
		throw new InternalRouteError(404, "Person not found");
	}

	const companionId = input.body.companionId ?? readImportedAdorelyId(person);
	if (!companionId) {
		throw new InternalRouteError(
			400,
			"Person does not have an Adorely import id"
		);
	}

	const client = new AdorelyDebugMcpClient({
		token: input.mcpToken,
		...(process.env.ADORELY_DEBUG_MCP_URL
			? { url: process.env.ADORELY_DEBUG_MCP_URL }
			: {}),
	});
	const assets = selectAdorelyReferenceAssets(
		await listAllAdorelyCompanionAssets(client, companionId)
	);
	if (assets.length === 0) {
		throw new InternalRouteError(400, "Adorely companion has no image assets");
	}

	const rows = person.generations
		.filter(isAdorelyDatasetGeneration)
		.sort(
			(left, right) =>
				getAdorelyDatasetOrder(left) - getAdorelyDatasetOrder(right)
		);
	if (rows.length === 0) {
		throw new InternalRouteError(
			400,
			"Person has no Adorely-imported dataset rows"
		);
	}

	const targetCount = Math.min(
		input.body.targetImportedAssetCount ?? rows.length,
		rows.length,
		assets.length
	);
	const repairItems = buildAdorelyRepairItems({
		assets,
		rows,
		targetCount,
	});
	const mainAsset = assets.find((asset) => asset.isMainPhoto) ?? assets[0];
	if (!mainAsset) {
		throw new InternalRouteError(400, "Adorely companion has no main asset");
	}

	return {
		plan: {
			apply: input.body.apply,
			companionId,
			importedDatasetRowCount: rows.length,
			mainAsset: toRepairAsset(mainAsset),
			personId: person.id,
			selectedAssetCount: repairItems.length,
			updates: repairItems.map((item) => ({
				assetId: item.asset.assetId,
				datasetOrder: item.datasetOrder,
				generationId: item.generationId,
				previousAssetId: item.previousAssetId,
				previousUrl: item.previousUrl,
				sourceUrl: item.asset.url,
				variantId: item.asset.variantId,
			})),
		},
		repairInput: {
			companionId,
			items: repairItems.map((item) => ({
				asset: item.asset,
				datasetOrder: item.datasetOrder,
				generationId: item.generationId,
			})),
			mainAsset: toRepairAsset(mainAsset),
			personId: person.id,
		},
	};
}

function getInternalRouteErrorStatus(error: unknown) {
	if (error instanceof z.ZodError) {
		return 400;
	}
	if (error instanceof InternalRouteError) {
		return error.status;
	}
	return 500;
}

export function createInternalRoutes(service: PersonsService) {
	const app = new Hono();

	const isAuthorized = (token: string | undefined) =>
		token === env.TRAINING_CONTROL_TOKEN;

	app.post("/generator-executions", async (c) => {
		const token = c.req.header(GENERATOR_CALLBACK_TOKEN_HEADER);
		if (token !== env.GENERATOR_CALLBACK_TOKEN) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const payload = (await c.req.json()) as {
			context: Record<string, unknown>;
			execution: GeneratorExecutionRecord;
		};
		const person = await service.applyExecutionCallback(payload);
		return c.json({ person });
	});

	app.get("/persons", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		return c.json({ persons: await service.listPersons() });
	});

	app.get("/persons/:personId", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const person = await service.getPersonById(c.req.param("personId"));
		if (!person) {
			return c.json({ error: "Person not found" }, 404);
		}
		return c.json({ person });
	});

	app.post("/persons/:personId/cancel-lora-training", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		try {
			const person = await service.cancelLoraTraining(c.req.param("personId"));
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}
			return c.json({ person });
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Unable to cancel training.",
				},
				400
			);
		}
	});

	app.post("/persons/:personId/retrain-lora", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		try {
			const body = (await c.req.json().catch(() => ({}))) as {
				outputName?: string;
				referencePrompt?: string;
				regenerateDataset?: boolean;
				triggerWord?: string;
			};
			const person = await service.startLoraTraining(c.req.param("personId"), {
				outputName: body.outputName,
				referencePrompt: body.referencePrompt,
				regenerateDataset: body.regenerateDataset,
				triggerWord: body.triggerWord,
			});
			if (!person) {
				return c.json({ error: "Person not found" }, 404);
			}
			return c.json({ person }, 202);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Unable to enqueue retraining job.",
				},
				400
			);
		}
	});

	app.post("/persons/:personId/reupload-adorely-assets", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const mcpToken = resolveAdorelyMcpToken();
		if (!mcpToken) {
			return c.json(
				{
					error:
						"Adorely MCP token is not configured. Set ADORELY_DEBUG_MCP_TOKEN on persons-api.",
				},
				503
			);
		}

		try {
			const body = reuploadAdorelyAssetsSchema.parse(
				await c.req.json().catch(() => ({}))
			);
			const repair = await buildAdorelyRepairPlan({
				body,
				mcpToken,
				personId: c.req.param("personId"),
				service,
			});

			if (!body.apply) {
				return c.json({ plan: repair.plan });
			}

			const result = await service.reuploadAdorelyImportedAssets(
				repair.repairInput
			);

			return c.json({ plan: repair.plan, result });
		} catch (error) {
			const responseStatus = getInternalRouteErrorStatus(error);
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Unable to reupload Adorely assets.",
				},
				responseStatus
			);
		}
	});

	app.post("/lora-trainings", async (c) => {
		const token = c.req
			.header("authorization")
			?.replace(bearerPrefixPattern, "");
		if (!isAuthorized(token)) {
			return c.json({ error: "Unauthorized callback" }, 401);
		}

		const payload = (await c.req.json()) as {
			context: Record<string, unknown>;
			event: unknown;
		};
		const person = await service.applyLoraTrainingEvent(payload);
		return c.json({ person });
	});

	return app;
}
