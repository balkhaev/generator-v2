CREATE TYPE "public"."lora_base_model" AS ENUM('z-image', 'flux', 'sdxl', 'other');--> statement-breakpoint
CREATE TYPE "public"."lora_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "lora" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_model" "lora_base_model" NOT NULL,
	"source_url" text,
	"s3_key" text NOT NULL,
	"s3_url" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"default_weight" double precision DEFAULT 1 NOT NULL,
	"status" "lora_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lora_slug_unique" ON "lora" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "lora_base_model_idx" ON "lora" USING btree ("base_model");--> statement-breakpoint
CREATE INDEX "lora_status_idx" ON "lora" USING btree ("status");