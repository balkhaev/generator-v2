import { relations } from "drizzle-orm";
import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const personGenerationMediaTypeEnum = pgEnum(
	"person_generation_media_type",
	["image", "video", "audio"]
);

export const personGenerationStatusEnum = pgEnum("person_generation_status", [
	"ready",
	"queued",
	"failed",
]);

export const person = pgTable(
	"person",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description").notNull().default(""),
		referencePhotoUrl: text("reference_photo_url").notNull(),
		datasetUrl: text("dataset_url"),
		loraUrl: text("lora_url"),
		photoUrl: text("photo_url"),
		videoUrl: text("video_url"),
		voiceWavUrl: text("voice_wav_url"),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("person_name_idx").on(table.name),
		uniqueIndex("person_slug_unique").on(table.slug),
	]
);

export const personGeneration = pgTable(
	"person_generation",
	{
		id: text("id").primaryKey(),
		personId: text("person_id")
			.notNull()
			.references(() => person.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		prompt: text("prompt").notNull().default(""),
		mediaType: personGenerationMediaTypeEnum("media_type").notNull(),
		status: personGenerationStatusEnum("status").notNull().default("ready"),
		previewUrl: text("preview_url"),
		sourceUrl: text("source_url").notNull(),
		operatorRunId: text("operator_run_id"),
		operatorScenarioId: text("operator_scenario_id"),
		errorSummary: text("error_summary"),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("person_generation_person_id_idx").on(table.personId),
		index("person_generation_status_idx").on(table.status),
		index("person_generation_operator_run_id_idx").on(table.operatorRunId),
	]
);

export const personRelations = relations(person, ({ many }) => ({
	generations: many(personGeneration),
}));

export const personGenerationRelations = relations(
	personGeneration,
	({ one }) => ({
		person: one(person, {
			fields: [personGeneration.personId],
			references: [person.id],
		}),
	})
);
