CREATE TABLE "dispatch_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"lead_action_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"phase" text NOT NULL,
	"phase_number" integer,
	"day_bucket" text NOT NULL,
	"status" text DEFAULT 'reservada' NOT NULL,
	"ycloud_message_id" text,
	"claimed_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dispatch_claims" ADD CONSTRAINT "dispatch_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatch_claims_tenant_bucket_status_idx" ON "dispatch_claims" USING btree ("tenant_id","day_bucket","status");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_claims_viva_unq" ON "dispatch_claims" USING btree ("lead_action_id") WHERE "dispatch_claims"."status" = 'reservada';