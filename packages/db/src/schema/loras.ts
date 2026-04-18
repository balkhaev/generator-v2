import {
	bigint,
	doublePrecision,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const loraStatusEnum = pgEnum("lora_status", ["active", "archived"]);

// Wan 2.2 A14B is a dual-expert model (high-noise + low-noise transformer).
// LoRAs trained for it usually come as a pair of files; we store each file as
// its own row and link them via `pairGroupId`. `variant` records which expert
// the file targets (`both` is the legacy single-LoRA case, `null` is for
// non-dual-expert base models like Flux).
export const loraVariantEnum = pgEnum("lora_variant", ["high", "low", "both"]);

export const lora = pgTable(
	"lora",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		baseModel: text("base_model").notNull(),
		sourceUrl: text("source_url"),
		s3Key: text("s3_key").notNull(),
		s3Url: text("s3_url").notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
		defaultWeight: doublePrecision("default_weight").notNull().default(1),
		variant: loraVariantEnum("variant"),
		pairGroupId: text("pair_group_id"),
		status: loraStatusEnum("status").notNull().default("active"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("lora_slug_unique").on(table.slug),
		index("lora_base_model_idx").on(table.baseModel),
		index("lora_status_idx").on(table.status),
		index("lora_pair_group_idx").on(table.pairGroupId),
	]
);
