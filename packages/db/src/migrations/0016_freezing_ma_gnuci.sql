CREATE TYPE "public"."runpod_template_mode" AS ENUM('pod', 'serverless');--> statement-breakpoint
CREATE TABLE "runpod_network_volume" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"runpod_volume_id" text NOT NULL,
	"datacenter" text NOT NULL,
	"size_gb" integer DEFAULT 0 NOT NULL,
	"gpu_type_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runpod_pod_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workflow_key" text NOT NULL,
	"mode" "runpod_template_mode" DEFAULT 'pod' NOT NULL,
	"runpod_template_id" text,
	"runpod_endpoint_id" text,
	"image_name" text,
	"gpu_type_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"container_disk_in_gb" integer,
	"volume_in_gb" integer,
	"cloud_type" text,
	"keep_alive_ms" integer,
	"timeout_ms" integer,
	"default_env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runpod_pod_template_volume" (
	"pod_template_id" text NOT NULL,
	"volume_id" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "runpod_pod_template_volume_pod_template_id_volume_id_pk" PRIMARY KEY("pod_template_id","volume_id")
);
--> statement-breakpoint
ALTER TABLE "studio_scenario" ADD COLUMN "runpod_pod_template_id" text;--> statement-breakpoint
ALTER TABLE "runpod_pod_template_volume" ADD CONSTRAINT "runpod_pod_template_volume_pod_template_id_runpod_pod_template_id_fk" FOREIGN KEY ("pod_template_id") REFERENCES "public"."runpod_pod_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runpod_pod_template_volume" ADD CONSTRAINT "runpod_pod_template_volume_volume_id_runpod_network_volume_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."runpod_network_volume"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runpod_network_volume_name_uidx" ON "runpod_network_volume" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "runpod_network_volume_runpod_id_uidx" ON "runpod_network_volume" USING btree ("runpod_volume_id");--> statement-breakpoint
CREATE INDEX "runpod_network_volume_datacenter_idx" ON "runpod_network_volume" USING btree ("datacenter");--> statement-breakpoint
CREATE UNIQUE INDEX "runpod_pod_template_name_uidx" ON "runpod_pod_template" USING btree ("name");--> statement-breakpoint
CREATE INDEX "runpod_pod_template_workflow_key_idx" ON "runpod_pod_template" USING btree ("workflow_key");--> statement-breakpoint
CREATE INDEX "runpod_pod_template_mode_idx" ON "runpod_pod_template" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "runpod_pod_template_volume_priority_idx" ON "runpod_pod_template_volume" USING btree ("pod_template_id","priority");--> statement-breakpoint
ALTER TABLE "studio_scenario" ADD CONSTRAINT "studio_scenario_runpod_pod_template_id_runpod_pod_template_id_fk" FOREIGN KEY ("runpod_pod_template_id") REFERENCES "public"."runpod_pod_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_scenario_runpod_pod_template_id_idx" ON "studio_scenario" USING btree ("runpod_pod_template_id");