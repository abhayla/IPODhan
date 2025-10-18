-- Create data_source enum if it doesn't exist
DO $$ BEGIN
 CREATE TYPE "public"."data_source" AS ENUM('MANUAL', 'SCRAPER', 'NSE_PAST_API');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Modify listing_performance table
ALTER TABLE "listing_performance" ALTER COLUMN "ipo_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_performance" ALTER COLUMN "listing_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_performance" ALTER COLUMN "issue_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_performance" ALTER COLUMN "listing_gain_percent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "symbol" varchar(20);--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "company_name" varchar(255);--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "listing_date" date;--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "data_source" "data_source" DEFAULT 'MANUAL';--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;