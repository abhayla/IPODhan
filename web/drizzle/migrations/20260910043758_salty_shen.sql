DROP INDEX "idx_field_sources_ipo_table_field";--> statement-breakpoint
ALTER TABLE "data_conflicts" ADD COLUMN "row_key" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "field_sources" ADD COLUMN "row_key" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_data_conflicts_ipo_table_row" ON "data_conflicts" USING btree ("ipo_id","table_name","row_key");--> statement-breakpoint
CREATE INDEX "idx_field_sources_ipo_table_field" ON "field_sources" USING btree ("ipo_id","table_name","row_key","field_name");