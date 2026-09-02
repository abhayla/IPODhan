-- T-428 (WP C-1) — schema for the 54 price-band-ad / filing fields.
--
-- Non-destructive additive migration: 5 new enums, 7 new tables, 6 new
-- columns on existing tables. Nothing is dropped, retyped, or backfilled.
-- `financial_data` FY2022-2024 columns are untouched (a gated drop is a
-- separate, later decision — see docs/reviews/price-band-ad-field-inventory.md).
--
-- Generated the drizzle-kit way: `drizzle-kit generate` against a throwaway
-- empty-history config (same technique 0038 documents) to get drizzle's own
-- DDL for the current schema.ts, then hand-extracted ONLY the statements for
-- the objects this migration actually adds, and wrapped every one idempotent
-- (IF NOT EXISTS / duplicate_object) per drizzle-migration-gated-ddl.md so
-- replaying this file is a no-op anywhere the objects already exist.
--
-- Enum-name collision check (T-403 round-2 lesson: an enum named like its own
-- table silently breaks with 42710): none of the 5 new enum names below match
-- any existing enum name or any table name (existing or new) in this repo —
-- verified against the full pgEnum()/pgTable() list in schema.ts and recorded
-- in docs/reviews/T-428-plan.md. `financial_statement_basis` is deliberately
-- distinct from the pre-existing `financial_statement_type` enum (different
-- values, different purpose — the latter backs `ipo_financials`).

-- New enums.
DO $$ BEGIN
  CREATE TYPE "pricing_event" AS ENUM ('PRICE_BAND_AD', 'PROSPECTUS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "financial_statement_basis" AS ENUM ('RESTATED', 'STANDALONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "financial_unit" AS ENUM ('MILLION', 'LAKH', 'CRORE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "acquisition_period" AS ENUM ('1Y', '18M', '3Y');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "intermediary_role" AS ENUM ('BRLM', 'REGISTRAR', 'SYNDICATE', 'SPONSOR_BANK', 'ESCROW_BANK', 'PUBLIC_ISSUE_BANK');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- New tables.
CREATE TABLE IF NOT EXISTS "financial_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"basis" "financial_statement_basis" NOT NULL,
	"unit" "financial_unit" NOT NULL,
	"revenue" numeric(18, 2),
	"total_income" numeric(18, 2),
	"ebitda" numeric(18, 2),
	"pat" numeric(18, 2),
	"net_worth" numeric(18, 2),
	"eps_basic" numeric(18, 2),
	"eps_diluted" numeric(18, 2),
	"op_cash_flow" numeric(18, 2),
	"dscr" numeric(18, 2),
	"rent_expense" numeric(18, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_financial_statements_ipo_fy_basis" UNIQUE("ipo_id","fiscal_year","basis")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ipo_valuation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"pricing_event" "pricing_event" NOT NULL,
	"price_floor" numeric(18, 2),
	"price_cap" numeric(18, 2),
	"shares_at_floor" bigint, -- share count -- never numeric; round-7 class
	"shares_at_cap" bigint, -- share count -- never numeric; round-7 class
	"mcap_at_floor" numeric(18, 2),
	"mcap_at_cap" numeric(18, 2),
	"pe_at_floor" numeric(18, 2),
	"pe_at_cap" numeric(18, 2),
	"pe_not_ascertainable_reason" text,
	"ronw_weighted_3y" numeric(18, 2),
	"face_value_multiple_floor" numeric(18, 2),
	"face_value_multiple_cap" numeric(18, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_ipo_valuation_ipo_pricing_event" UNIQUE("ipo_id","pricing_event")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promoters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"shares_held" bigint,
	"waca" numeric(18, 2),
	"waca_last_year" numeric(18, 2),
	"is_promoter_group" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promoter_acquisition_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"period" "acquisition_period" NOT NULL,
	"waca" numeric(18, 2),
	"cap_multiple" numeric(18, 2),
	"price_low" numeric(18, 2),
	"price_high" numeric(18, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ipo_intermediaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"role" "intermediary_role" NOT NULL,
	"name" varchar(255) NOT NULL,
	"sebi_reg_no" varchar(50),
	"contact_person" varchar(255),
	"phone" varchar(50),
	"email" varchar(255),
	"grievance_email" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brlm_track_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brlm_name" varchar(255) NOT NULL,
	"as_of_date" date NOT NULL,
	"issues_3y" integer,
	"closed_below_issue_price" integer,
	"source_ipo_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ipo_risk_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"heading" varchar(500) NOT NULL,
	"body" text,
	"kpis" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_ipo_risk_factors_ipo_seq" UNIQUE("ipo_id","seq")
);
--> statement-breakpoint

-- Foreign keys for the new tables, guarded against duplicate_object so a
-- replay against a database that already has them is a no-op.
DO $$ BEGIN
  ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ipo_valuation" ADD CONSTRAINT "ipo_valuation_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "promoters" ADD CONSTRAINT "promoters_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "promoter_acquisition_ranges" ADD CONSTRAINT "promoter_acquisition_ranges_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ipo_intermediaries" ADD CONSTRAINT "ipo_intermediaries_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "brlm_track_record" ADD CONSTRAINT "brlm_track_record_source_ipo_id_ipos_id_fk" FOREIGN KEY ("source_ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ipo_risk_factors" ADD CONSTRAINT "ipo_risk_factors_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Indexes for the new tables.
CREATE INDEX IF NOT EXISTS "idx_financial_statements_ipo_id" ON "financial_statements" USING btree ("ipo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_valuation_ipo_id" ON "ipo_valuation" USING btree ("ipo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_promoters_ipo_id" ON "promoters" USING btree ("ipo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_promoter_acquisition_ranges_ipo_id" ON "promoter_acquisition_ranges" USING btree ("ipo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_intermediaries_ipo_id" ON "ipo_intermediaries" USING btree ("ipo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_intermediaries_ipo_id_role" ON "ipo_intermediaries" USING btree ("ipo_id","role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brlm_track_record_source_ipo_id" ON "brlm_track_record" USING btree ("source_ipo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_brlm_track_record_brlm_name" ON "brlm_track_record" USING btree ("brlm_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_risk_factors_ipo_id" ON "ipo_risk_factors" USING btree ("ipo_id");
--> statement-breakpoint

-- New columns on existing tables (all nullable, all additive).
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "cin" varchar(21);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "filing_date" date;
--> statement-breakpoint
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "designated_exchange" varchar(10);
--> statement-breakpoint
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "lot_multiple" integer;
--> statement-breakpoint
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "allocation_pct" jsonb;
--> statement-breakpoint
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "pre_ipo_placement" boolean;
