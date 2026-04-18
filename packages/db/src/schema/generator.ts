import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const generatorExecutionStatusEnum = pgEnum(
	"generator_execution_status",
	["queued", "running", "succeeded", "failed"]
);

export const generatorExecution = pgTable(
	"generator_execution",
	{
		id: text("id").primaryKey(),
		workflowKey: text("workflow_key").notNull(),
		prompt: text("prompt").notNull(),
		params: jsonb("params")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		callback: jsonb("callback").$type<{
			context?: Record<string, unknown>;
			token?: string;
			url?: string;
		} | null>(),
		inputImageUrl: text("input_image_url"),
		providerEndpointId: text("provider_endpoint_id"),
		providerJobId: text("provider_job_id"),
		status: generatorExecutionStatusEnum("status").notNull().default("queued"),
		errorSummary: text("error_summary"),
		artifacts: jsonb("artifacts")
			.$type<Array<{ url: string | null }>>()
			.notNull()
			.default([]),
		progressPct: integer("progress_pct"),
		queuePosition: integer("queue_position"),
		lastLogLine: text("last_log_line"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("generator_execution_status_idx").on(table.status),
		index("generator_execution_provider_job_id_idx").on(table.providerJobId),
		index("generator_execution_workflow_key_idx").on(table.workflowKey),
	]
);
