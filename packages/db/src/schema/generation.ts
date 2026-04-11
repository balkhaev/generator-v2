import { relations } from "drizzle-orm";
import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const scenarioRunStatusEnum = pgEnum("scenario_run_status", [
	"queued",
	"running",
	"succeeded",
	"failed",
]);

export const scenario = pgTable(
	"scenario",
	{
		id: text("id").primaryKey(),
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
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("scenario_workflow_key_idx").on(table.workflowKey)]
);

export const scenarioRun = pgTable(
	"scenario_run",
	{
		id: text("id").primaryKey(),
		scenarioId: text("scenario_id")
			.notNull()
			.references(() => scenario.id, { onDelete: "cascade" }),
		workflowKey: text("workflow_key").notNull(),
		inputImageUrl: text("input_image_url").notNull(),
		providerEndpointId: text("provider_endpoint_id"),
		providerJobId: text("provider_job_id"),
		status: scenarioRunStatusEnum("status").notNull().default("queued"),
		errorSummary: text("error_summary"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("scenario_run_scenario_id_idx").on(table.scenarioId),
		index("scenario_run_provider_endpoint_id_idx").on(table.providerEndpointId),
		index("scenario_run_provider_job_id_idx").on(table.providerJobId),
		index("scenario_run_status_idx").on(table.status),
	]
);

export const artifact = pgTable(
	"artifact",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => scenarioRun.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(),
		url: text("url").notNull(),
		metadata: jsonb("metadata")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("artifact_run_id_idx").on(table.runId)]
);

export const scenarioRelations = relations(scenario, ({ many }) => ({
	runs: many(scenarioRun),
}));

export const scenarioRunRelations = relations(scenarioRun, ({ many, one }) => ({
	scenario: one(scenario, {
		fields: [scenarioRun.scenarioId],
		references: [scenario.id],
	}),
	artifacts: many(artifact),
}));

export const artifactRelations = relations(artifact, ({ one }) => ({
	run: one(scenarioRun, {
		fields: [artifact.runId],
		references: [scenarioRun.id],
	}),
}));
