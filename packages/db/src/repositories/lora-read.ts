import type {
	LoraBaseModel,
	LoraRegistryEntry,
	LoraSourceProvider,
	LoraStatus,
	LoraVariant,
} from "@generator/contracts/loras";

import { db as defaultDb } from "../index";
import { and, desc, eq } from "../operators";
import { lora } from "../schema/loras";

type Db = typeof defaultDb;
type LoraRow = typeof lora.$inferSelect;

const civitaiHostPattern = /(^|\.)civitai\.(com|red)$/iu;
const huggingFaceHostPattern = /(^|\.)huggingface\.co$/iu;

function deriveSourceProvider(
	sourceUrl: null | string
): Exclude<LoraSourceProvider, "auto"> | undefined {
	if (!sourceUrl) {
		return;
	}
	try {
		const url = new URL(sourceUrl);
		if (civitaiHostPattern.test(url.hostname)) {
			return "civitai";
		}
		if (huggingFaceHostPattern.test(url.hostname)) {
			return "huggingface";
		}
		return "direct";
	} catch {
		return "direct";
	}
}

export function mapLoraRow(row: LoraRow): LoraRegistryEntry {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		description: row.description,
		baseModel: row.baseModel as LoraBaseModel,
		sourceUrl: row.sourceUrl,
		s3Key: row.s3Key,
		s3Url: row.s3Url,
		sizeBytes: row.sizeBytes,
		defaultWeight: row.defaultWeight,
		variant: (row.variant ?? null) as LoraVariant | null,
		pairGroupId: row.pairGroupId ?? null,
		sourceProvider: deriveSourceProvider(row.sourceUrl),
		status: row.status as LoraStatus,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export interface ListLorasFilter {
	baseModel?: LoraBaseModel;
	status?: LoraStatus;
}

export interface LoraReadRepository {
	getById(id: string): Promise<LoraRegistryEntry | null>;
	getByPairGroupId(pairGroupId: string): Promise<LoraRegistryEntry[]>;
	getBySlug(slug: string): Promise<LoraRegistryEntry | null>;
	list(filter?: ListLorasFilter): Promise<LoraRegistryEntry[]>;
}

export function createLoraReadRepository(
	database: Db = defaultDb
): LoraReadRepository {
	return {
		async getById(id) {
			const [row] = await database.select().from(lora).where(eq(lora.id, id));
			return row ? mapLoraRow(row) : null;
		},
		async getByPairGroupId(pairGroupId) {
			const rows = await database
				.select()
				.from(lora)
				.where(eq(lora.pairGroupId, pairGroupId));
			return rows.map(mapLoraRow);
		},
		async getBySlug(slug) {
			const [row] = await database
				.select()
				.from(lora)
				.where(eq(lora.slug, slug));
			return row ? mapLoraRow(row) : null;
		},
		async list(filter = {}) {
			const clauses: ReturnType<typeof eq>[] = [];
			if (filter.baseModel) {
				clauses.push(eq(lora.baseModel, filter.baseModel));
			}
			if (filter.status) {
				clauses.push(eq(lora.status, filter.status));
			}
			const query = database.select().from(lora);
			const rows =
				clauses.length > 0
					? await query.where(and(...clauses)).orderBy(desc(lora.createdAt))
					: await query.orderBy(desc(lora.createdAt));
			return rows.map(mapLoraRow);
		},
	};
}
