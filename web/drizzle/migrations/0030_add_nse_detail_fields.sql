-- Add new NSE detail fields to capture all data from NSE IPO API
-- Generated: 2025-10-30

-- ==================== EXTEND DOCUMENT TYPE ENUM ====================
-- Add new document types from NSE
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'RATIOS_BASIS_ISSUE_PRICE';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'BIDDING_CENTERS';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SAMPLE_APPLICATION_FORMS';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SECURITY_PARAMS_PRE_ANCHOR';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'SECURITY_PARAMS_POST_ANCHOR';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'ANCHOR_ALLOCATION_REPORT';
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'ASBA_PROCESSING_CIRCULAR';

-- ==================== EXTEND IPO_DETAILS TABLE ====================
-- Add 17 new fields to capture NSE issueInfo data
ALTER TABLE "ipo_details"
-- Phase 1: High Priority Fields
ADD COLUMN IF NOT EXISTS "upi_cutoff_time" varchar(50),
ADD COLUMN IF NOT EXISTS "max_retail_subscription" numeric(12, 2),
ADD COLUMN IF NOT EXISTS "max_employee_subscription" numeric(12, 2),
ADD COLUMN IF NOT EXISTS "employee_discount" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "sponsor_banks" text[],

-- Phase 2: Medium Priority Fields
ADD COLUMN IF NOT EXISTS "tick_size" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "ipo_market_timings" varchar(50),
ADD COLUMN IF NOT EXISTS "category_details" jsonb,
ADD COLUMN IF NOT EXISTS "sub_categories_upi" text[],

-- Phase 3: Low Priority Fields
ADD COLUMN IF NOT EXISTS "remarks" text,
ADD COLUMN IF NOT EXISTS "e_form_link" varchar(500),
ADD COLUMN IF NOT EXISTS "scsb_branches_link" varchar(500),
ADD COLUMN IF NOT EXISTS "graph_logic_pdf_link" varchar(500),

-- Educational Resources
ADD COLUMN IF NOT EXISTS "video_link_upi" varchar(500),
ADD COLUMN IF NOT EXISTS "video_link_bhim" varchar(500),
ADD COLUMN IF NOT EXISTS "mobile_apps_upi_link" varchar(500);

-- Add comments for documentation
COMMENT ON COLUMN "ipo_details"."upi_cutoff_time" IS 'UPI mandate confirmation deadline (e.g., "5:00 PM on last day")';
COMMENT ON COLUMN "ipo_details"."max_retail_subscription" IS 'Maximum subscription amount for retail investors in INR';
COMMENT ON COLUMN "ipo_details"."max_employee_subscription" IS 'Maximum subscription amount for employees in INR';
COMMENT ON COLUMN "ipo_details"."employee_discount" IS 'Discount per share offered to employees in INR';
COMMENT ON COLUMN "ipo_details"."sponsor_banks" IS 'Array of sponsor bank names';
COMMENT ON COLUMN "ipo_details"."category_details" IS 'JSON object containing category codes and descriptions';
COMMENT ON COLUMN "ipo_details"."remarks" IS 'IPO-specific important notices and remarks';

-- ==================== EXTEND SUBSCRIPTIONS TABLE ====================
-- Add 15 new fields for sub-category breakdowns and enhanced tracking
ALTER TABLE "subscriptions"
-- QIB Sub-category breakdowns
ADD COLUMN IF NOT EXISTS "qib_fii_subscription" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "qib_domestic_fi_subscription" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "qib_mutual_fund_subscription" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "qib_others_subscription" numeric(10, 2),

-- NII Sub-category breakdowns
ADD COLUMN IF NOT EXISTS "nii_corporates_subscription" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "nii_individuals_subscription" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "nii_others_subscription" numeric(10, 2),

-- Cut-off vs Price bid tracking
ADD COLUMN IF NOT EXISTS "retail_cut_off_shares" bigint,
ADD COLUMN IF NOT EXISTS "retail_price_bid_shares" bigint,
ADD COLUMN IF NOT EXISTS "employee_cut_off_shares" bigint,
ADD COLUMN IF NOT EXISTS "employee_price_bid_shares" bigint,
ADD COLUMN IF NOT EXISTS "cut_off_bids_total" bigint,

-- Exchange-wise breakdown
ADD COLUMN IF NOT EXISTS "total_bids_nse" bigint,
ADD COLUMN IF NOT EXISTS "total_bids_bse" bigint,
ADD COLUMN IF NOT EXISTS "total_bids_combined" bigint;

-- Add comments for documentation
COMMENT ON COLUMN "subscriptions"."qib_fii_subscription" IS 'Foreign Institutional Investors subscription within QIB category';
COMMENT ON COLUMN "subscriptions"."qib_domestic_fi_subscription" IS 'Domestic Financial Institutions subscription within QIB category';
COMMENT ON COLUMN "subscriptions"."qib_mutual_fund_subscription" IS 'Mutual Funds subscription within QIB category';
COMMENT ON COLUMN "subscriptions"."cut_off_bids_total" IS 'Total number of shares bid at cut-off price';
COMMENT ON COLUMN "subscriptions"."total_bids_combined" IS 'Combined total bids from NSE and BSE';

-- ==================== CREATE IPO_DEMAND_GRAPH TABLE ====================
-- New table to store price-wise cumulative demand data
CREATE TABLE IF NOT EXISTS "ipo_demand_graph" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ipo_id" uuid NOT NULL REFERENCES "ipos"("id") ON DELETE CASCADE,
    "timestamp" timestamp NOT NULL,
    "price_point" numeric(10, 2), -- NULL for cut-off price
    "is_cut_off" boolean DEFAULT false NOT NULL,
    "cumulative_quantity" bigint NOT NULL,
    "exchange" "exchange" NOT NULL, -- NSE, BSE, or BOTH
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_demand_ipo_exchange_price" ON "ipo_demand_graph"("ipo_id", "exchange", "price_point");
CREATE INDEX IF NOT EXISTS "idx_demand_timestamp" ON "ipo_demand_graph"("timestamp");

-- Add table comment
COMMENT ON TABLE "ipo_demand_graph" IS 'Price-wise cumulative demand data for IPOs, captured from NSE/BSE APIs';
COMMENT ON COLUMN "ipo_demand_graph"."price_point" IS 'Price point in INR (NULL for cut-off)';
COMMENT ON COLUMN "ipo_demand_graph"."is_cut_off" IS 'True if this row represents cut-off price demand';
COMMENT ON COLUMN "ipo_demand_graph"."cumulative_quantity" IS 'Total shares bid at this price point and above';
COMMENT ON COLUMN "ipo_demand_graph"."exchange" IS 'Exchange source: NSE, BSE, or BOTH for combined data';