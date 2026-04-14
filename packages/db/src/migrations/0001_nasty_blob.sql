CREATE TYPE "public"."generator_execution_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."studio_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "generator_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_key" text NOT NULL,
	"prompt" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"callback" jsonb,
	"input_image_url" text,
	"provider_endpoint_id" text,
	"provider_job_id" text,
	"status" "generator_execution_status" DEFAULT 'queued' NOT NULL,
	"error_summary" text,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_run" (
	"id" text PRIMARY KEY NOT NULL,
	"generator_run_id" text,
	"scenario_id" text NOT NULL,
	"workflow_key" text NOT NULL,
	"input_image_url" text NOT NULL,
	"provider_endpoint_id" text,
	"provider_job_id" text,
	"status" "studio_run_status" DEFAULT 'queued' NOT NULL,
	"error_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "studio_scenario" (
	"id" text PRIMARY KEY NOT NULL,
	"generator_scenario_id" text,
	"name" text NOT NULL,
	"workflow_key" text NOT NULL,
	"prompt" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_artifact" ADD CONSTRAINT "studio_artifact_run_id_studio_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."studio_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_run" ADD CONSTRAINT "studio_run_scenario_id_studio_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."studio_scenario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generator_execution_status_idx" ON "generator_execution" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generator_execution_provider_job_id_idx" ON "generator_execution" USING btree ("provider_job_id");--> statement-breakpoint
CREATE INDEX "generator_execution_workflow_key_idx" ON "generator_execution" USING btree ("workflow_key");--> statement-breakpoint
CREATE INDEX "studio_artifact_run_id_idx" ON "studio_artifact" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "studio_run_scenario_id_idx" ON "studio_run" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "studio_run_generator_run_id_idx" ON "studio_run" USING btree ("generator_run_id");--> statement-breakpoint
CREATE INDEX "studio_run_provider_endpoint_id_idx" ON "studio_run" USING btree ("provider_endpoint_id");--> statement-breakpoint
CREATE INDEX "studio_run_provider_job_id_idx" ON "studio_run" USING btree ("provider_job_id");--> statement-breakpoint
CREATE INDEX "studio_run_status_idx" ON "studio_run" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_run_generator_run_uidx" ON "studio_run" USING btree ("generator_run_id");--> statement-breakpoint
CREATE INDEX "studio_scenario_workflow_key_idx" ON "studio_scenario" USING btree ("workflow_key");--> statement-breakpoint
CREATE INDEX "studio_scenario_generator_scenario_id_idx" ON "studio_scenario" USING btree ("generator_scenario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_scenario_generator_scenario_uidx" ON "studio_scenario" USING btree ("generator_scenario_id");