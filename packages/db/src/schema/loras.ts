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

export const loraBaseModelEnum = pgEnum("lora_base_model", [
	"z-image",
	"flux",
	"sdxl",
	"other",
]);

export const loraStatusEnum = pgEnum("lora_status", ["active", "archived"]);

export const lora = pgTable(
	"lora",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		baseModel: loraBaseModelEnum("base_model").notNull(),
		sourceUrl: text("source_url"),
		s3Key: text("s3_key").notNull(),
		s3Url: text("s3_url").notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
		defaultWeight: doublePrecision("default_weight").notNull().default(1),
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
	]
);
