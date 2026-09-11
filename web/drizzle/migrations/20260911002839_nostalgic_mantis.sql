CREATE TYPE "public"."field_plan_state" AS ENUM('PENDING', 'SUPPLIED', 'NOT_PRINTED', 'NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED');--> statement-breakpoint
CREATE TABLE "ipo_field_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"rank1_source" varchar(32),
	"rank2_source" varchar(32),
	"rank3_source" varchar(32),
	"state" "field_plan_state" DEFAULT 'PENDING' NOT NULL,
	"chosen_source" varchar(32),
	"chosen_rank" integer,
	"chosen_document_id" uuid,
	"chosen_document_type" varchar(50),
	"chosen_sha256" varchar(64),
	"chosen_page" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_due_at" timestamp,
	"claimed_at" timestamp,
	"claim_token" varchar(64),
	"verify_due_at" timestamp,
	"verify_state" varchar(32),
	"verify_source" varchar(32),
	"verify_value" text,
	"disagreement_count" integer DEFAULT 0 NOT NULL,
	"manifest_version" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_ipo_field_plan" UNIQUE("ipo_id","table_name","field_name")
);
--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD CONSTRAINT "ipo_field_plan_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD CONSTRAINT "ipo_field_plan_chosen_document_id_documents_id_fk" FOREIGN KEY ("chosen_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_ipo_id" ON "ipo_field_plan" USING btree ("ipo_id");--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_state_next_due" ON "ipo_field_plan" USING btree ("state","next_due_at");--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_verify_due" ON "ipo_field_plan" USING btree ("verify_due_at");--> statement-breakpoint
CREATE INDEX "idx_ipo_field_plan_manifest_version" ON "ipo_field_plan" USING btree ("manifest_version");