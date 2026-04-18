CREATE TABLE "integration_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"key_name" text NOT NULL,
	"value_ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "runtime_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_provider_key_idx" ON "integration_credential" USING btree ("provider","key_name");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_setting_domain_key_idx" ON "runtime_setting" USING btree ("domain","key");