-- Migration: Add anchor_investors table
-- Story 11.10: Implement Anchor Investors Details Section for IPO Detail Page
-- Created: 2025-10-26

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

-- Add foreign key constraint
DO $$ BEGIN
  ALTER TABLE "anchor_investors" ADD CONSTRAINT "anchor_investors_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add check constraints
DO $$ BEGIN
  ALTER TABLE "anchor_investors" ADD CONSTRAINT "anchor_investors_total_shares_offered_check" CHECK ("total_shares_offered" > 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "anchor_investors" ADD CONSTRAINT "anchor_investors_total_amount_raised_check" CHECK ("total_amount_raised" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "anchor_investors" ADD CONSTRAINT "anchor_investors_count_check" CHECK ("anchor_investors_count" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_anchor_investors_ipo_id" ON "anchor_investors" ("ipo_id");
CREATE INDEX IF NOT EXISTS "idx_anchor_investors_bid_date" ON "anchor_investors" ("bid_date");
