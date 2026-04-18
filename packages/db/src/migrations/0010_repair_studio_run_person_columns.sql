-- Идемпотентный ремонт схемы studio_*: на проде drizzle silently
-- skipped 0007/0008/0009, потому что в 0006 был раздутый `when`
-- (1776600000000), а Drizzle migrator пропускает миграции с when <
-- max(created_at) в drizzle.__drizzle_migrations. Из-за этого
-- studio-api падает при SELECT из studio_run (нет lora_person_id и
-- input_person_id/input_person_generation_id) и потенциально при
-- работе с studio_scenario_shot (таблица не создана).
--
-- Эта миграция добавляет / создаёт всё то, что должны были сделать
-- 0007 и 0009, но через IF NOT EXISTS, чтобы безопасно отработать
-- и на «здоровых» окружениях, где всё уже на месте.
ALTER TABLE "studio_run" ADD COLUMN IF NOT EXISTS "input_person_id" text;--> statement-breakpoint
ALTER TABLE "studio_run" ADD COLUMN IF NOT EXISTS "input_person_generation_id" text;--> statement-breakpoint
ALTER TABLE "studio_run" ADD COLUMN IF NOT EXISTS "lora_person_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_run_input_person_id_idx" ON "studio_run" USING btree ("input_person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_run_lora_person_id_idx" ON "studio_run" USING btree ("lora_person_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_scenario_shot" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"artifact_url" text NOT NULL,
	"artifact_kind" text DEFAULT 'image' NOT NULL,
	"note" text,
	"person_id" text,
	"person_generation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "studio_scenario_shot" ADD CONSTRAINT "studio_scenario_shot_run_id_studio_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."studio_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "studio_scenario_shot" ADD CONSTRAINT "studio_scenario_shot_scenario_id_studio_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."studio_scenario"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_scenario_shot_run_id_idx" ON "studio_scenario_shot" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_scenario_shot_scenario_id_idx" ON "studio_scenario_shot" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_scenario_shot_person_id_idx" ON "studio_scenario_shot" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_scenario_shot_created_at_idx" ON "studio_scenario_shot" USING btree ("created_at");--> statement-breakpoint
DROP TABLE IF EXISTS "asset_release_item" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "asset_release" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "volume_distribution_job" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."asset_release_group";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."asset_release_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."volume_distribution_status";
