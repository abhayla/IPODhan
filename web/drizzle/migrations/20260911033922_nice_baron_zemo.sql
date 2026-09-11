ALTER TABLE "ipo_field_plan" DROP CONSTRAINT "unique_ipo_field_plan";--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD COLUMN "row_key" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ipo_field_plan" ADD CONSTRAINT "unique_ipo_field_plan" UNIQUE("ipo_id","table_name","row_key","field_name");