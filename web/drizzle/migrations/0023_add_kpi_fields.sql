-- Migration: Add KPI highlight fields to financial_data table
-- Story 11.11: Implement KPI Highlight Section for IPO Detail Page
-- Date: 2025-10-26

-- Add 4 new fields to financial_data table
ALTER TABLE "financial_data"
ADD COLUMN IF NOT EXISTS "market_cap" numeric(15, 2),
ADD COLUMN IF NOT EXISTS "pre_ipo_eps" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "post_ipo_eps" numeric(10, 2),
ADD COLUMN IF NOT EXISTS "ronw" numeric(5, 2);

-- Add comments for documentation
COMMENT ON COLUMN "financial_data"."market_cap" IS 'Market capitalization in ₹ crores';
COMMENT ON COLUMN "financial_data"."pre_ipo_eps" IS 'Pre-IPO Earnings Per Share';
COMMENT ON COLUMN "financial_data"."post_ipo_eps" IS 'Post-IPO Earnings Per Share';
COMMENT ON COLUMN "financial_data"."ronw" IS 'Return on Net Worth %';
