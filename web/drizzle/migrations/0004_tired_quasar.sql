CREATE TYPE "public"."scraper_source" AS ENUM('NSE', 'BSE', 'API_FALLBACK');--> statement-breakpoint
CREATE TYPE "public"."scraper_status" AS ENUM('SUCCESS', 'FAILURE', 'PARTIAL');--> statement-breakpoint
CREATE TABLE "scraper_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"records_processed" integer DEFAULT 0,
	"records_failed" integer DEFAULT 0,
	"duration_ms" integer NOT NULL,
	"error_message" text,
	"error_stack" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "last_scraped_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_scraper_logs_created_at" ON "scraper_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_scraper_logs_source_created_at" ON "scraper_logs" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "idx_scraper_logs_status" ON "scraper_logs" USING btree ("status");