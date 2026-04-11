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

export const studioRunStatusEnum = pgEnum("studio_run_status", [
	"queued",
	"running",
	"succeeded",
	"failed",
]);

export const studioScenario = pgTable(
	"studio_scenario",
	{
		id: text("id").primaryKey(),
		generatorScenarioId: text("generator_scenario_id"),
		name: text("name").notNull(),
		workflowKey: text("workflow_key").notNull(),
		prompt: text("prompt").notNull(),
		params: jsonb("params")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("studio_scenario_workflow_key_idx").on(table.workflowKey),
		index("studio_scenario_generator_scenario_id_idx").on(
			table.generatorScenarioId
		),
		uniqueIndex("studio_scenario_generator_scenario_uidx").on(
			table.generatorScenarioId
		),
	]
);

export const studioRun = pgTable(
	"studio_run",
	{
		id: text("id").primaryKey(),
		generatorRunId: text("generator_run_id"),
		scenarioId: text("scenario_id")
			.notNull()
			.references(() => studioScenario.id, { onDelete: "cascade" }),
		workflowKey: text("workflow_key").notNull(),
		inputImageUrl: text("input_image_url").notNull(),
		providerEndpointId: text("provider_endpoint_id"),
		providerJobId: text("provider_job_id"),
		status: studioRunStatusEnum("status").notNull().default("queued"),
		errorSummary: text("error_summary"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("studio_run_scenario_id_idx").on(table.scenarioId),
		index("studio_run_generator_run_id_idx").on(table.generatorRunId),
		index("studio_run_provider_endpoint_id_idx").on(table.providerEndpointId),
		index("studio_run_provider_job_id_idx").on(table.providerJobId),
		index("studio_run_status_idx").on(table.status),
		uniqueIndex("studio_run_generator_run_uidx").on(table.generatorRunId),
	]
);

export const studioArtifact = pgTable(
	"studio_artifact",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => studioRun.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(),
		url: text("url").notNull(),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("studio_artifact_run_id_idx").on(table.runId)]
);

export const studioScenarioRelations = relations(
	studioScenario,
	({ many }) => ({
		runs: many(studioRun),
	})
);

export const studioRunRelations = relations(studioRun, ({ many, one }) => ({
	artifacts: many(studioArtifact),
	scenario: one(studioScenario, {
		fields: [studioRun.scenarioId],
		references: [studioScenario.id],
	}),
}));

export const studioArtifactRelations = relations(studioArtifact, ({ one }) => ({
	run: one(studioRun, {
		fields: [studioArtifact.runId],
		references: [studioRun.id],
	}),
}));
