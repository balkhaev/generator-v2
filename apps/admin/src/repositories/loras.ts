import type {
	LoraBaseModel,
	LoraRegistryEntry,
	LoraSourceProvider,
	LoraStatus,
} from "@generator/contracts/loras";
import { db } from "@generator/db";
import { and, desc, eq } from "@generator/db/operators";
import { lora } from "@generator/db/schema/loras";

type Db = typeof db;

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

function mapLora(row: LoraRow): LoraRegistryEntry {
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
		sourceProvider: deriveSourceProvider(row.sourceUrl),
		status: row.status as LoraStatus,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export interface CreateLoraRecordInput {
	baseModel: LoraBaseModel;
	defaultWeight: number;
	description: string;
	id: string;
	name: string;
	s3Key: string;
	s3Url: string;
	sizeBytes: number;
	slug: string;
	sourceUrl: string | null;
}

export interface ListLorasFilter {
	baseModel?: LoraBaseModel;
	status?: LoraStatus;
}

export interface UpdateLoraRecordInput {
	baseModel?: LoraBaseModel;
	defaultWeight?: number;
	description?: string;
	name?: string;
	status?: LoraStatus;
}

export interface LoraRepository {
	create(input: CreateLoraRecordInput): Promise<LoraRegistryEntry>;
	delete(id: string): Promise<LoraRegistryEntry | null>;
	getById(id: string): Promise<LoraRegistryEntry | null>;
	getBySlug(slug: string): Promise<LoraRegistryEntry | null>;
	list(filter: ListLorasFilter): Promise<LoraRegistryEntry[]>;
	update(
		id: string,
		patch: UpdateLoraRecordInput
	): Promise<LoraRegistryEntry | null>;
}

export function createDrizzleLoraRepository(database: Db = db): LoraRepository {
	return {
		async create(input) {
			const [row] = await database
				.insert(lora)
				.values({
					id: input.id,
					slug: input.slug,
					name: input.name,
					description: input.description,
					baseModel: input.baseModel,
					sourceUrl: input.sourceUrl,
					s3Key: input.s3Key,
					s3Url: input.s3Url,
					sizeBytes: input.sizeBytes,
					defaultWeight: input.defaultWeight,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to create LoRA record");
			}
			return mapLora(row);
		},
		async getById(id) {
			const [row] = await database.select().from(lora).where(eq(lora.id, id));
			return row ? mapLora(row) : null;
		},
		async getBySlug(slug) {
			const [row] = await database
				.select()
				.from(lora)
				.where(eq(lora.slug, slug));
			return row ? mapLora(row) : null;
		},
		async list(filter) {
			const clauses = [] as ReturnType<typeof eq>[];
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
			return rows.map(mapLora);
		},
		async delete(id) {
			const [row] = await database
				.delete(lora)
				.where(eq(lora.id, id))
				.returning();
			return row ? mapLora(row) : null;
		},
		async update(id, patch) {
			const [row] = await database
				.update(lora)
				.set({
					...(patch.name === undefined ? {} : { name: patch.name }),
					...(patch.description === undefined
						? {}
						: { description: patch.description }),
					...(patch.baseModel === undefined
						? {}
						: { baseModel: patch.baseModel }),
					...(patch.defaultWeight === undefined
						? {}
						: { defaultWeight: patch.defaultWeight }),
					...(patch.status === undefined ? {} : { status: patch.status }),
				})
				.where(eq(lora.id, id))
				.returning();
			return row ? mapLora(row) : null;
		},
	};
}
