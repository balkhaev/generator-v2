ALTER TABLE "artifact" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scenario" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scenario_run" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "artifact" CASCADE;--> statement-breakpoint
DROP TABLE "scenario" CASCADE;--> statement-breakpoint
DROP TABLE "scenario_run" CASCADE;--> statement-breakpoint
ALTER TABLE "lora" ALTER COLUMN "base_model" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."scenario_run_status";--> statement-breakpoint
DROP TYPE "public"."lora_base_model";