CREATE TABLE "field_sources_retired" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"row_key" varchar(200) NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"source" "scraper_source" NOT NULL,
	"record" jsonb NOT NULL,
	"retired_at" timestamp DEFAULT now() NOT NULL,
	"retired_reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peer_companies" ADD COLUMN "source_document_type" varchar(32);--> statement-breakpoint
ALTER TABLE "field_sources_retired" ADD CONSTRAINT "field_sources_retired_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_field_sources_retired_ipo_table_row" ON "field_sources_retired" USING btree ("ipo_id","table_name","row_key");