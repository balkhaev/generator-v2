ALTER TABLE "studio_run" ADD COLUMN "lora_person_id" text;--> statement-breakpoint
CREATE INDEX "studio_run_lora_person_id_idx" ON "studio_run" USING btree ("lora_person_id");