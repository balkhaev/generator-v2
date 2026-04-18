CREATE TYPE "public"."lora_variant" AS ENUM('high', 'low', 'both');--> statement-breakpoint
ALTER TABLE "lora" ADD COLUMN "variant" "lora_variant";--> statement-breakpoint
ALTER TABLE "lora" ADD COLUMN "pair_group_id" text;--> statement-breakpoint
CREATE INDEX "lora_pair_group_idx" ON "lora" USING btree ("pair_group_id");