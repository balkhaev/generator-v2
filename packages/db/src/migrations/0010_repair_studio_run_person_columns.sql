-- Идемпотентный ремонт studio_run: на проде запись 0009 в
-- drizzle.__drizzle_migrations присутствует, но соответствующий ALTER TABLE
-- не выполнился (column "lora_person_id" does not exist). Заодно страхуемся
-- по input_person_id / input_person_generation_id из 0007 — если по той же
-- причине их тоже нет.
ALTER TABLE "studio_run" ADD COLUMN IF NOT EXISTS "input_person_id" text;--> statement-breakpoint
ALTER TABLE "studio_run" ADD COLUMN IF NOT EXISTS "input_person_generation_id" text;--> statement-breakpoint
ALTER TABLE "studio_run" ADD COLUMN IF NOT EXISTS "lora_person_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_run_input_person_id_idx" ON "studio_run" USING btree ("input_person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_run_lora_person_id_idx" ON "studio_run" USING btree ("lora_person_id");
