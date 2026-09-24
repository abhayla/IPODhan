-- Item 6 (spec §2.5, OD-91), migration 0060: per-document field receipts + ipo_field_plan.superseded_by.
-- Hand-trimmed from drizzle-kit's output to this migration's statements only.
CREATE TABLE IF NOT EXISTS "document_field_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"row_key" varchar(200) DEFAULT '' NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_document_field_receipt" UNIQUE("document_id","table_name","row_key","field_name")
);
--> statement-breakpoint
ALTER TABLE "document_field_receipts" ADD CONSTRAINT "document_field_receipts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD COLUMN IF NOT EXISTS "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD CONSTRAINT "ipo_field_plan_superseded_by_documents_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
