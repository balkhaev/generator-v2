CREATE TABLE "studio_scenario_shot" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"scenario_id" text NOT NULL,
	"artifact_url" text NOT NULL,
	"artifact_kind" text DEFAULT 'image' NOT NULL,
	"note" text,
	"person_id" text,
	"person_generation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_run" ADD COLUMN "input_person_id" text;--> statement-breakpoint
ALTER TABLE "studio_run" ADD COLUMN "input_person_generation_id" text;--> statement-breakpoint
ALTER TABLE "studio_scenario_shot" ADD CONSTRAINT "studio_scenario_shot_run_id_studio_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."studio_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_scenario_shot" ADD CONSTRAINT "studio_scenario_shot_scenario_id_studio_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."studio_scenario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_scenario_shot_run_id_idx" ON "studio_scenario_shot" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "studio_scenario_shot_scenario_id_idx" ON "studio_scenario_shot" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "studio_scenario_shot_person_id_idx" ON "studio_scenario_shot" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "studio_scenario_shot_created_at_idx" ON "studio_scenario_shot" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "studio_run_input_person_id_idx" ON "studio_run" USING btree ("input_person_id");