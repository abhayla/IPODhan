-- Enable PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('DRHP', 'RHP', 'PROSPECTUS', 'ADDENDUM');--> statement-breakpoint
CREATE TYPE "public"."exchange" AS ENUM('NSE', 'BSE', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."financial_statement_type" AS ENUM('CONSOLIDATED', 'STANDALONE');--> statement-breakpoint
CREATE TYPE "public"."holiday_type" AS ENUM('TRADING', 'SETTLEMENT', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."ipo_category" AS ENUM('MAINBOARD', 'SME', 'RIGHTS', 'NCD');--> statement-breakpoint
CREATE TYPE "public"."ipo_status" AS ENUM('UPCOMING', 'OPEN', 'CLOSED', 'LISTED');--> statement-breakpoint
CREATE TABLE "broker_affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_name" varchar(255) NOT NULL,
	"broker_logo" text,
	"affiliate_url" text NOT NULL,
	"display_text" varchar(100),
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"title" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"file_size" bigint,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"revenue_fy2022" numeric(12, 2),
	"revenue_fy2023" numeric(12, 2),
	"revenue_fy2024" numeric(12, 2),
	"profit_fy2022" numeric(12, 2),
	"profit_fy2023" numeric(12, 2),
	"profit_fy2024" numeric(12, 2),
	"net_worth" numeric(12, 2),
	"pe_ratio" numeric(10, 2),
	"eps" numeric(10, 2),
	"roe" numeric(5, 2),
	"debt_to_equity" numeric(10, 2),
	"reserves_and_surplus" numeric(12, 2),
	"total_assets" numeric(12, 2),
	"total_borrowing" numeric(12, 2),
	CONSTRAINT "financial_data_ipo_id_unique" UNIQUE("ipo_id")
);
--> statement-breakpoint
CREATE TABLE "gmp_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"timestamp" timestamp NOT NULL,
	"gmp" integer NOT NULL,
	"expected_listing_price" integer,
	"subject_rate" integer,
	"kostak_rate" integer,
	"sauda_details" text,
	"source" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"category" "ipo_category" NOT NULL,
	"sector" varchar(100),
	"issue_size" numeric(10, 2),
	"price_range_min" integer,
	"price_range_max" integer,
	"lot_size" integer,
	"status" "ipo_status" NOT NULL,
	"open_date" date,
	"close_date" date,
	"allotment_date" date,
	"listing_date" date,
	"company_description" text,
	"face_value" integer,
	"listing_exchanges" jsonb,
	"registrar" varchar(255),
	"lead_managers" jsonb,
	"rating" integer,
	"rating_rationale" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ipos_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "listing_performance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"listing_price" integer NOT NULL,
	"issue_price" integer NOT NULL,
	"listing_gain_percent" numeric(5, 2) NOT NULL,
	"current_price" integer,
	"current_gain_percent" numeric(5, 2),
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "listing_performance_ipo_id_unique" UNIQUE("ipo_id")
);
--> statement-breakpoint
CREATE TABLE "market_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"description" varchar(255) NOT NULL,
	"exchange" "exchange" NOT NULL,
	"type" "holiday_type" NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peer_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"sector" varchar(100),
	"is_listed" boolean NOT NULL,
	"pe_ratio" numeric(10, 2),
	"eps" numeric(10, 2),
	"diluted_eps" numeric(10, 2),
	"ronw" numeric(5, 2),
	"nav" numeric(10, 2),
	"pbv_ratio" numeric(10, 2),
	"financial_statement_type" "financial_statement_type",
	"data_source" varchar(100),
	"last_updated" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"short_name" varchar(100),
	"email" varchar(255),
	"phone" varchar(20),
	"website" text,
	"allotment_check_url" text,
	"address" text,
	"logo_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL,
	"timestamp" timestamp NOT NULL,
	"qib_subscription" numeric(10, 2),
	"nii_subscription" numeric(10, 2),
	"retail_subscription" numeric(10, 2),
	"total_subscription" numeric(10, 2),
	"employee_subscription" numeric(10, 2),
	"others_subscription" numeric(10, 2),
	"anchor_investor_subscription" numeric(10, 2),
	"retail_hni_subscription" numeric(10, 2),
	"retail_others_subscription" numeric(10, 2),
	"b_nii_subscription" numeric(10, 2),
	"s_nii_subscription" numeric(10, 2),
	"total_applications" integer,
	"total_shares_bid" bigint,
	"shares_offered" bigint
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_data" ADD CONSTRAINT "financial_data_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmp_records" ADD CONSTRAINT "gmp_records_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_performance" ADD CONSTRAINT "listing_performance_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_companies" ADD CONSTRAINT "peer_companies_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_broker_affiliates_active_order" ON "broker_affiliates" USING btree ("active","display_order");--> statement-breakpoint
CREATE INDEX "idx_gmp_records_ipo_timestamp" ON "gmp_records" USING btree ("ipo_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_ipos_status" ON "ipos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ipos_slug" ON "ipos" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_market_holidays_date" ON "market_holidays" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_market_holidays_year" ON "market_holidays" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_ipo_timestamp" ON "subscriptions" USING btree ("ipo_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_ipos_company_name_trgm" ON "ipos" USING gin ("company_name" gin_trgm_ops);