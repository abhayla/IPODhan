-- Create extraction_status enum (if not exists)
DO $$ BEGIN
  CREATE TYPE "public"."extraction_status" AS ENUM('PENDING', 'IN_PROGRESS', 'SUCCESS', 'PARTIAL', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create extraction_logs table
CREATE TABLE IF NOT EXISTS "extraction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid,
	"company_name" varchar(255) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_path" varchar(500),
	"file_size" integer,
	"total_pages" integer,
	"status" "extraction_status" DEFAULT 'PENDING' NOT NULL,
	"extractor_version" varchar(20),
	"extraction_method" varchar(50),
	"fields_extracted" integer DEFAULT 0,
	"total_fields" integer DEFAULT 16,
	"extracted_data" jsonb,
	"confidence_score" integer,
	"confidence_level" "confidence_level",
	"data_issues" jsonb,
	"duration_ms" integer,
	"pl_page_number" integer,
	"tables_processed" integer,
	"unit_detected" varchar(20),
	"error_message" text,
	"error_stack" text,
	"failure_reason" text,
	"uploaded_by" varchar(255),
	"reviewed_by" varchar(255),
	"review_notes" text,
	"is_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"reviewed_at" timestamp
);

-- Add foreign key constraint
DO $$ BEGIN
 ALTER TABLE "extraction_logs" ADD CONSTRAINT "extraction_logs_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_extraction_logs_ipo_id" ON "extraction_logs" USING btree ("ipo_id");
CREATE INDEX IF NOT EXISTS "idx_extraction_logs_status" ON "extraction_logs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_extraction_logs_created_at" ON "extraction_logs" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_extraction_logs_confidence" ON "extraction_logs" USING btree ("confidence_level");
CREATE INDEX IF NOT EXISTS "idx_extraction_logs_company" ON "extraction_logs" USING btree ("company_name");