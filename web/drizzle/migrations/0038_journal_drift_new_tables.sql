-- T-405 (#256) — stage 0: journal must rebuild the schema.
--
-- WHY THIS FILE EXISTS
-- ---------------------
-- Ten tables schema.ts declares were never created by ANY journaled migration:
-- their CREATE TABLE lives in a hand-authored .sql file in this same directory
-- (e.g. 0019_add_admin_settings.sql, 0027_data_flow_architecture_phase0.sql,
-- 0030_add_nse_detail_fields.sql) that was written before drizzle-kit's own
-- generate path got blocked (see .claude/rules/drizzle-migration-gated-ddl.md)
-- but was never added as an entry to meta/_journal.json — so `drizzle-kit
-- migrate` never applies it. Production has these tables (built from a dump +
-- hand-applied changes, not from the journal), so this drift was invisible
-- until `DROP SCHEMA public CASCADE` + `drizzle-kit migrate` was actually run
-- from empty (evidence/T-405/before-drift.txt).
--
-- This migration does NOT reuse those old files verbatim — they predate the
-- IF-NOT-EXISTS idempotency convention this project now requires
-- (drizzle-migration-gated-ddl.md) and some are not safe to replay against a
-- database that already has the tables (prod). Instead it recreates the exact
-- shape schema.ts declares (generated via `drizzle-kit generate` against a
-- throwaway empty-history config to get drizzle's own DDL, then wrapped in
-- IF NOT EXISTS / DO-guarded ADD CONSTRAINT so it is a no-op everywhere the
-- tables already exist, and additive everywhere they do not).
--
-- Every statement here is non-destructive: CREATE TYPE guarded against
-- duplicate_object, CREATE TABLE IF NOT EXISTS, ADD CONSTRAINT guarded against
-- duplicate_object, CREATE INDEX IF NOT EXISTS, ALTER TYPE ADD VALUE IF NOT
-- EXISTS. Nothing is dropped or retyped.

-- New enums schema.ts declares that no journaled migration has created yet.
DO $$ BEGIN
  CREATE TYPE "segment" AS ENUM ('MAINBOARD', 'SME');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "offering_type" AS ENUM ('IPO', 'FPO', 'RIGHTS', 'OFS', 'IPP', 'QIP', 'PREFERENTIAL', 'NCD', 'BONDS', 'INVITS', 'REITS', 'BUYBACK', 'DELISTING', 'TENDER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "issue_type" AS ENUM ('BOOK_BUILDING', 'FIXED_PRICE', 'HYBRID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- extraction_status: needed by extraction_logs.status below. Its own CREATE
-- TYPE lives only in 0001_add_extraction_logs_table.sql -- one of the
-- never-journaled files this migration backfills -- which is also the exact
-- enum the drizzle-migration-gated-ddl.md "pre-existing extraction_status
-- enum-rename prompt" refers to (an unrelated `db:generate` ambiguity, not a
-- reason this CREATE TYPE is unsafe to journal: it is a plain new enum on an
-- empty database, and a no-op everywhere it already exists).
DO $$ BEGIN
  CREATE TYPE "extraction_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'PARTIAL', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- scraper_source (0000_initial_schema) only ever got NSE/BSE/API_FALLBACK; the
-- field-priority-matrix's four other sources were added to schema.ts later and
-- never journaled as enum values (same class as 0036's document_type gap).
ALTER TYPE "scraper_source" ADD VALUE IF NOT EXISTS 'ADMIN';
--> statement-breakpoint
ALTER TYPE "scraper_source" ADD VALUE IF NOT EXISTS 'DRHP';
--> statement-breakpoint
ALTER TYPE "scraper_source" ADD VALUE IF NOT EXISTS 'MONEYCONTROL';
--> statement-breakpoint
ALTER TYPE "scraper_source" ADD VALUE IF NOT EXISTS 'CHITTORGARH';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_key" varchar(100) NOT NULL,
	"setting_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_settings_setting_key_unique" UNIQUE("setting_key")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "anchor_investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"bid_date" date NOT NULL,
	"total_shares_offered" bigint NOT NULL,
	"total_amount_raised" numeric(12, 2) NOT NULL,
	"anchor_investors_count" integer NOT NULL,
	"lock_in_50_percent_date" date NOT NULL,
	"lock_in_remaining_date" date NOT NULL,
	"investor_list" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"admin_user" varchar(255) NOT NULL,
	"action_type" varchar(100) NOT NULL,
	"ipo_id" uuid,
	"table_name" varchar(100),
	"field_name" varchar(100),
	"old_value" text,
	"new_value" text,
	"details" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "data_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"source1" "scraper_source" NOT NULL,
	"value1" text,
	"source2" "scraper_source" NOT NULL,
	"value2" text,
	"resolved_source" "scraper_source",
	"resolution_reason" varchar(100),
	"severity" varchar(20) DEFAULT 'INFO' NOT NULL,
	"admin_note" text,
	"resolved_at" timestamp,
	"resolved_by" varchar(255),
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

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
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "field_protection_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"ipo_id" uuid NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"auto_protected" boolean DEFAULT false NOT NULL,
	"is_permanent" boolean DEFAULT false NOT NULL,
	"manually_edited_at" timestamp,
	"manually_edited_by" varchar(255),
	"edit_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_field_per_ipo" UNIQUE("table_name","field_name","ipo_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "field_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"source" "scraper_source" NOT NULL,
	"confidence" integer DEFAULT 100 NOT NULL,
	"previous_value" text,
	"previous_source" "scraper_source",
	"data_lineage" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_field_source_per_ipo" UNIQUE("ipo_id","table_name","field_name")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ipo_demand_graph" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"timestamp" timestamp NOT NULL,
	"price_point" numeric(10, 2),
	"is_cut_off" boolean DEFAULT false NOT NULL,
	"cumulative_quantity" bigint NOT NULL,
	"exchange" "exchange" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ipo_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"issue_type" "issue_type",
	"fresh_issue" numeric(12, 2),
	"ofs_issue" numeric(12, 2),
	"cut_off_price" numeric(10, 2),
	"min_investment" numeric(12, 2),
	"registrar_link" varchar(500),
	"isin" varchar(12),
	"face_value" numeric(10, 2),
	"basis_of_allotment_date" date,
	"initiation_of_refunds_date" date,
	"credit_of_shares_date" date,
	"lead_managers" text[],
	"exchanges" text[],
	"company_description" text,
	"data_source" varchar(50) NOT NULL,
	"last_verified_at" timestamp,
	"company_address" text,
	"company_phone" varchar(50),
	"company_email" varchar(255),
	"company_city" varchar(100),
	"company_state" varchar(100),
	"company_pincode" varchar(10),
	"compliance_officer" varchar(255),
	"compliance_officer_phone" varchar(50),
	"compliance_officer_email" varchar(255),
	"qib_shares_offered" bigint,
	"nii_shares_offered" bigint,
	"retail_shares_offered" bigint,
	"retail_max_allottees" integer,
	"employee_shares_offered" bigint,
	"anchor_shares_offered" bigint,
	"upi_cutoff_time" varchar(50),
	"max_retail_subscription" numeric(12, 2),
	"max_employee_subscription" numeric(12, 2),
	"employee_discount" numeric(10, 2),
	"sponsor_banks" text[],
	"tick_size" numeric(10, 2),
	"ipo_market_timings" varchar(50),
	"category_details" jsonb,
	"sub_categories_upi" text[],
	"remarks" text,
	"e_form_link" varchar(500),
	"scsb_branches_link" varchar(500),
	"graph_logic_pdf_link" varchar(500),
	"video_link_upi" varchar(500),
	"video_link_bhim" varchar(500),
	"mobile_apps_upi_link" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ipo_details_ipo_id_unique" UNIQUE("ipo_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ipo_financials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"revenue_fy1" numeric(12, 2),
	"revenue_fy2" numeric(12, 2),
	"revenue_fy3" numeric(12, 2),
	"profit_fy1" numeric(12, 2),
	"profit_fy2" numeric(12, 2),
	"profit_fy3" numeric(12, 2),
	"pe_ratio" numeric(8, 2),
	"roe_percentage" numeric(5, 2),
	"debt_to_equity" numeric(8, 2),
	"pb_ratio" numeric(8, 2),
	"roce_percentage" numeric(5, 2),
	"industry_pe" numeric(8, 2),
	"peer_companies" text[],
	"financial_year_end" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ipo_financials_ipo_id_unique" UNIQUE("ipo_id")
);
--> statement-breakpoint

-- Foreign keys (guarded — duplicate_object means already applied)

DO $$ BEGIN
  ALTER TABLE "anchor_investors" ADD CONSTRAINT "anchor_investors_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "data_conflicts" ADD CONSTRAINT "data_conflicts_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "extraction_logs" ADD CONSTRAINT "extraction_logs_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "field_protection_metadata" ADD CONSTRAINT "field_protection_metadata_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "field_sources" ADD CONSTRAINT "field_sources_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ipo_demand_graph" ADD CONSTRAINT "ipo_demand_graph_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ipo_details" ADD CONSTRAINT "ipo_details_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "ipo_financials" ADD CONSTRAINT "ipo_financials_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Indexes (native IF NOT EXISTS)

CREATE INDEX IF NOT EXISTS "idx_admin_settings_key" ON "admin_settings" USING btree ("setting_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_anchor_investors_ipo_id" ON "anchor_investors" USING btree ("ipo_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_anchor_investors_bid_date" ON "anchor_investors" USING btree ("bid_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_audit_logs_timestamp" ON "audit_logs" USING btree ("timestamp" DESC NULLS LAST);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_audit_logs_admin_user" ON "audit_logs" USING btree ("admin_user");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_audit_logs_ipo_id" ON "audit_logs" USING btree ("ipo_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_audit_logs_action_type" ON "audit_logs" USING btree ("action_type");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_audit_logs_timestamp_admin" ON "audit_logs" USING btree ("timestamp" DESC NULLS LAST,"admin_user");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_data_conflicts_ipo_id" ON "data_conflicts" USING btree ("ipo_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_data_conflicts_field_name" ON "data_conflicts" USING btree ("field_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_data_conflicts_severity" ON "data_conflicts" USING btree ("severity");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_data_conflicts_detected_at" ON "data_conflicts" USING btree ("detected_at" DESC NULLS LAST);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_data_conflicts_unresolved" ON "data_conflicts" USING btree ("resolved_at") WHERE "data_conflicts"."resolved_at" is null;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_data_conflicts_ipo_unresolved" ON "data_conflicts" USING btree ("ipo_id","resolved_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_extraction_logs_ipo_id" ON "extraction_logs" USING btree ("ipo_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_extraction_logs_status" ON "extraction_logs" USING btree ("status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_extraction_logs_created_at" ON "extraction_logs" USING btree ("created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_extraction_logs_confidence" ON "extraction_logs" USING btree ("confidence_level");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_extraction_logs_company" ON "extraction_logs" USING btree ("company_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_protection_ipo_id" ON "field_protection_metadata" USING btree ("ipo_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_protection_table_name" ON "field_protection_metadata" USING btree ("table_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_protection_is_protected" ON "field_protection_metadata" USING btree ("is_protected");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_sources_ipo_id" ON "field_sources" USING btree ("ipo_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_sources_table_name" ON "field_sources" USING btree ("table_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_sources_field_name" ON "field_sources" USING btree ("field_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_sources_source" ON "field_sources" USING btree ("source");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_field_sources_ipo_table_field" ON "field_sources" USING btree ("ipo_id","table_name","field_name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_demand_ipo_exchange_price" ON "ipo_demand_graph" USING btree ("ipo_id","exchange","price_point");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_demand_timestamp" ON "ipo_demand_graph" USING btree ("timestamp");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ipo_details_ipo_id" ON "ipo_details" USING btree ("ipo_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ipo_details_data_source" ON "ipo_details" USING btree ("data_source");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ipo_details_isin" ON "ipo_details" USING btree ("isin");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ipo_financials_ipo_id" ON "ipo_financials" USING btree ("ipo_id");
