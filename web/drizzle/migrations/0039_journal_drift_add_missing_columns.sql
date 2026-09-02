-- T-405 (#256) -- stage 0: additive columns schema.ts declares that no
-- journaled migration ever added, on tables that DO exist on a journal-built
-- database (unlike 0038, which covers tables missing entirely).
--
-- Same root cause as 0038: these columns were added to schema.ts alongside a
-- hand-authored migration file that was never registered in
-- meta/_journal.json, so drizzle-kit migrate never ran it. Production has
-- them already (that history is documented against each source file below);
-- every ADD COLUMN here is IF NOT EXISTS, so it is a no-op there and additive
-- everywhere else. Nothing is dropped or retyped -- the seven live
-- COLUMN_TYPE_MISMATCH findings on gmp_records/listing_performance
-- (int -> numeric widening) stay OUT of scope here: they are destructive/
-- type-changing and already tracked in web/drizzle/migrations/_gated/
-- (B2_gmp_int_to_numeric.sql, C3_listing_performance_widen_precision.sql)
-- pending owner sign-off. See docs/reviews/T-405-plan.md for the full drift
-- table and this decision.

-- ipos -- 0015_restructure_category_to_segment_offering_type introduced
-- segment/offering_type; bse_scrip_code came later (_gated/C2, marked
-- additive-safe there but re-derived here as a plain journaled column so an
-- empty database gets it without a manual _gated apply); the rest are
-- historical/GMP snapshot columns from 0009_add_historical_ipo_fields and
-- 0018_add_scraper_locked_index.
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "bse_scrip_code" varchar(20);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "segment" "segment";
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "offering_type" "offering_type";
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "scraper_locked" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "scraper_lock_note" text;
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "last_manual_edit_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "subscription_retail" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "subscription_hni" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "subscription_qib" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "subscription_total" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "gmp_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "gmp_percentage_historical" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "gmp_updated_at_historical" timestamp;
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "listing_price_historical" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "listing_gain_percentage" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "listing_gain_amount" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "listing_date_historical" date;
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "current_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "current_gain_percentage" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "current_gain_amount" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "current_price_updated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "historical_data_source" varchar(100);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "historical_data_scraped_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "objectives" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipos_segment" ON "ipos" USING btree ("segment");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipos_offering_type" ON "ipos" USING btree ("offering_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipos_segment_offering_type" ON "ipos" USING btree ("segment","offering_type");
--> statement-breakpoint

-- financial_data -- 0023_add_enhanced_financial_metrics.
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "market_cap" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "pre_ipo_eps" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "post_ipo_eps" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "ronw" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "ebitda_fy2022" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "ebitda_fy2023" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "ebitda_fy2024" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "total_income_fy2022" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "total_income_fy2023" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "total_income_fy2024" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "total_borrowings" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "current_ratio" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "quick_ratio" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "financial_data" ADD COLUMN IF NOT EXISTS "inventory_turnover" numeric(5, 2);
--> statement-breakpoint

-- gmp_records -- the percentage sibling of the existing gmp column
-- (0013_fix_listing_performance_schema era); the widen of gmp/expected_
-- listing_price/subject_rate/kostak_rate from int to numeric(10,2) is a TYPE
-- CHANGE and stays in _gated/B2_gmp_int_to_numeric.sql, not here.
ALTER TABLE "gmp_records" ADD COLUMN IF NOT EXISTS "gmp_percentage" numeric(10, 2);
--> statement-breakpoint

-- ipo_reviews -- 0029_add_review_moderation_fields.
ALTER TABLE "ipo_reviews" ADD COLUMN IF NOT EXISTS "segment" "segment";
--> statement-breakpoint
ALTER TABLE "ipo_reviews" ADD COLUMN IF NOT EXISTS "is_approved" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "ipo_reviews" ADD COLUMN IF NOT EXISTS "moderated_by" varchar(255);
--> statement-breakpoint
ALTER TABLE "ipo_reviews" ADD COLUMN IF NOT EXISTS "moderated_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_reviews_segment" ON "ipo_reviews" USING btree ("segment");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_reviews_segment_year_published" ON "ipo_reviews" USING btree ("segment","year","published_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ipo_reviews_approved" ON "ipo_reviews" USING btree ("is_approved","ipo_id");
--> statement-breakpoint

-- listing_performance -- 0035/_gated/C1_listing_ohlc_add_columns (additive OHLC
-- snapshot columns only; the int -> numeric widen of the pre-existing price
-- columns is _gated/C3_listing_performance_widen_precision.sql, not here).
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "listing_open_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "listing_high_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "listing_low_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "listing_close_price" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "last_traded_price" numeric(10, 2);
--> statement-breakpoint

-- subscriptions -- 0030_add_nse_detail_fields (BSE/NSE bid-book breakdown).
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "qib_fii_subscription" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "qib_domestic_fi_subscription" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "qib_mutual_fund_subscription" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "qib_others_subscription" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "nii_corporates_subscription" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "nii_individuals_subscription" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "nii_others_subscription" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "retail_cut_off_shares" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "retail_price_bid_shares" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "employee_cut_off_shares" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "employee_price_bid_shares" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cut_off_bids_total" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "total_bids_nse" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "total_bids_bse" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "total_bids_combined" bigint;
