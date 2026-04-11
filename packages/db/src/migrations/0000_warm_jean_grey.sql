CREATE TYPE "public"."asset_release_group" AS ENUM('checkpoints', 'models', 'loras', 'vae', 'workflows');--> statement-breakpoint
CREATE TYPE "public"."asset_release_status" AS ENUM('distributing', 'ready', 'degraded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."volume_distribution_status" AS ENUM('queued', 'syncing', 'verifying', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scenario_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."person_generation_media_type" AS ENUM('image', 'video', 'audio');--> statement-breakpoint
CREATE TYPE "public"."person_generation_status" AS ENUM('ready', 'queued', 'failed');--> statement-breakpoint
CREATE TABLE "asset_release" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"group" "asset_release_group" NOT NULL,
	"status" "asset_release_status" DEFAULT 'distributing' NOT NULL,
	"storage_prefix" text NOT NULL,
	"bucket" text NOT NULL,
	"files_total" bigint DEFAULT 0 NOT NULL,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"error_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "asset_release_item" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"target_relative_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volume_distribution_job" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"volume_id" text NOT NULL,
	"volume_name" text,
	"region" text,
	"status" "volume_distribution_status" DEFAULT 'queued' NOT NULL,
	"pod_id" text,
	"progress_key" text NOT NULL,
	"files_total" bigint DEFAULT 0 NOT NULL,
	"files_synced" bigint DEFAULT 0 NOT NULL,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"bytes_synced" bigint DEFAULT 0 NOT NULL,
	"error_summary" text,
	"last_heartbeat_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workflow_key" text NOT NULL,
	"prompt" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_run" (
	"id" text PRIMARY KEY NOT NULL,
	"scenario_id" text NOT NULL,
	"workflow_key" text NOT NULL,
	"input_image_url" text NOT NULL,
	"provider_endpoint_id" text,
	"provider_job_id" text,
	"status" "scenario_run_status" DEFAULT 'queued' NOT NULL,
	"error_summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference_photo_url" text NOT NULL,
	"dataset_url" text,
	"lora_url" text,
	"photo_url" text,
	"video_url" text,
	"voice_wav_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_generation" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"media_type" "person_generation_media_type" NOT NULL,
	"status" "person_generation_status" DEFAULT 'ready' NOT NULL,
	"preview_url" text,
	"source_url" text NOT NULL,
	"operator_run_id" text,
	"operator_scenario_id" text,
	"error_summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_release_item" ADD CONSTRAINT "asset_release_item_release_id_asset_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."asset_release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_distribution_job" ADD CONSTRAINT "volume_distribution_job_release_id_asset_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."asset_release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_run_id_scenario_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scenario_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_run" ADD CONSTRAINT "scenario_run_scenario_id_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_generation" ADD CONSTRAINT "person_generation_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_release_status_idx" ON "asset_release" USING btree ("status");--> statement-breakpoint
CREATE INDEX "asset_release_created_at_idx" ON "asset_release" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "asset_release_item_release_id_idx" ON "asset_release_item" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "asset_release_item_storage_key_idx" ON "asset_release_item" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "volume_distribution_job_release_id_idx" ON "volume_distribution_job" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "volume_distribution_job_status_idx" ON "volume_distribution_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "volume_distribution_job_volume_id_idx" ON "volume_distribution_job" USING btree ("volume_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "artifact_run_id_idx" ON "artifact" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "scenario_workflow_key_idx" ON "scenario" USING btree ("workflow_key");--> statement-breakpoint
CREATE INDEX "scenario_run_scenario_id_idx" ON "scenario_run" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "scenario_run_provider_endpoint_id_idx" ON "scenario_run" USING btree ("provider_endpoint_id");--> statement-breakpoint
CREATE INDEX "scenario_run_provider_job_id_idx" ON "scenario_run" USING btree ("provider_job_id");--> statement-breakpoint
CREATE INDEX "scenario_run_status_idx" ON "scenario_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "person_name_idx" ON "person" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "person_slug_unique" ON "person" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "person_generation_person_id_idx" ON "person_generation" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_generation_status_idx" ON "person_generation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "person_generation_operator_run_id_idx" ON "person_generation" USING btree ("operator_run_id");