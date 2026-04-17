DROP TABLE IF EXISTS "artifact" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "scenario" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "scenario_run" CASCADE;--> statement-breakpoint
ALTER TABLE "lora" ALTER COLUMN "base_model" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."scenario_run_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."lora_base_model";
