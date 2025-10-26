-- Migration: Add promoter holding fields to financial_data table
-- Story: 11.9 - Implement Promoter Holding Display
-- Created: 2025-10-26
-- Description: Adds pre-issue and post-issue promoter holding percentage fields

-- Add promoter holding columns to financial_data table
ALTER TABLE "financial_data"
ADD COLUMN IF NOT EXISTS "promoter_holding_pre_issue" numeric(5, 2),
ADD COLUMN IF NOT EXISTS "promoter_holding_post_issue" numeric(5, 2);

-- Add CHECK constraints to ensure values are between 0 and 100
ALTER TABLE "financial_data"
ADD CONSTRAINT "chk_promoter_holding_pre_issue_range"
  CHECK ("promoter_holding_pre_issue" IS NULL OR ("promoter_holding_pre_issue" >= 0 AND "promoter_holding_pre_issue" <= 100));

ALTER TABLE "financial_data"
ADD CONSTRAINT "chk_promoter_holding_post_issue_range"
  CHECK ("promoter_holding_post_issue" IS NULL OR ("promoter_holding_post_issue" >= 0 AND "promoter_holding_post_issue" <= 100));

-- Add comments for documentation
COMMENT ON COLUMN "financial_data"."promoter_holding_pre_issue" IS 'Promoter shareholding percentage before IPO (e.g., 77.00)';
COMMENT ON COLUMN "financial_data"."promoter_holding_post_issue" IS 'Promoter shareholding percentage after IPO (e.g., 62.00)';
