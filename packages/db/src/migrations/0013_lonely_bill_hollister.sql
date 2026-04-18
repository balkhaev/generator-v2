ALTER TABLE "generator_execution" ADD COLUMN "progress_pct" integer;--> statement-breakpoint
ALTER TABLE "generator_execution" ADD COLUMN "queue_position" integer;--> statement-breakpoint
ALTER TABLE "generator_execution" ADD COLUMN "last_log_line" text;