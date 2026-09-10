CREATE TABLE "field_extraction_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"row_key" varchar(200) DEFAULT '' NOT NULL,
	"document_id" uuid,
	"document_sha256" char(64),
	"rule_id" varchar(100) NOT NULL,
	"rank_attempted" "scraper_source" NOT NULL,
	"extracted_value" text,
	"cause" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_extraction_failures" ADD CONSTRAINT "field_extraction_failures_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_extraction_failures" ADD CONSTRAINT "field_extraction_failures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_field_extraction_failures_ipo_id" ON "field_extraction_failures" USING btree ("ipo_id");--> statement-breakpoint
CREATE INDEX "idx_field_extraction_failures_field_name" ON "field_extraction_failures" USING btree ("field_name");--> statement-breakpoint
CREATE INDEX "idx_field_extraction_failures_rule_id" ON "field_extraction_failures" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "idx_field_extraction_failures_unresolved" ON "field_extraction_failures" USING btree ("ipo_id","table_name","field_name") WHERE "field_extraction_failures"."resolved_at" is null;