-- Story 9.17a: Schema Migration - FPO Category and Separate BSE/NSE Prices
-- Add FPO category to enum and separate exchange price fields

-- Add FPO to ipoCategoryEnum
ALTER TYPE "public"."ipo_category" ADD VALUE 'FPO';--> statement-breakpoint

-- Add separate BSE/NSE price fields to listing_performance
ALTER TABLE "listing_performance" ADD COLUMN "current_price_bse" integer;--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN "current_price_nse" integer;--> statement-breakpoint

-- Migrate existing data: copy currentPrice to both exchange fields
UPDATE "listing_performance"
SET
  "current_price_bse" = "current_price",
  "current_price_nse" = "current_price"
WHERE "current_price" IS NOT NULL;--> statement-breakpoint

-- Add comments for clarity
COMMENT ON COLUMN "listing_performance"."current_price_bse" IS 'Current trading price at BSE';--> statement-breakpoint
COMMENT ON COLUMN "listing_performance"."current_price_nse" IS 'Current trading price at NSE';--> statement-breakpoint
COMMENT ON COLUMN "listing_performance"."current_price" IS 'Deprecated: Use current_price_bse or current_price_nse. Kept for backward compatibility.';