import type {
	LoraBaseModel,
	LoraRegistryEntry,
	LoraStatus,
} from "@generator/contracts/loras";
import { db } from "@generator/db";
import { eq } from "@generator/db/operators";
import {
	createLoraReadRepository,
	type LoraReadRepository,
	mapLoraRow,
} from "@generator/db/repositories/lora-read";
import { lora } from "@generator/db/schema/loras";

export type { ListLorasFilter } from "@generator/db/repositories/lora-read";

type Db = typeof db;

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

export interface UpdateLoraRecordInput {
	baseModel?: LoraBaseModel;
	defaultWeight?: number;
	description?: string;
	name?: string;
	status?: LoraStatus;
}

export interface LoraRepository extends LoraReadRepository {
	create(input: CreateLoraRecordInput): Promise<LoraRegistryEntry>;
	delete(id: string): Promise<LoraRegistryEntry | null>;
	update(
		id: string,
		patch: UpdateLoraRecordInput
	): Promise<LoraRegistryEntry | null>;
}

export function createDrizzleLoraRepository(database: Db = db): LoraRepository {
	const reader = createLoraReadRepository(database);
	return {
		...reader,
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
			return mapLoraRow(row);
		},
		async delete(id) {
			const [row] = await database
				.delete(lora)
				.where(eq(lora.id, id))
				.returning();
			return row ? mapLoraRow(row) : null;
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
			return row ? mapLoraRow(row) : null;
		},
	};
}
