-- Migration: Fix listing_performance table schema mismatch
-- Date: 2025-10-18
-- Issue: Database schema was out of sync with Drizzle schema definition
-- Root Cause: Missing columns that were defined in packages/shared/src/db/schema.ts

-- Add missing columns to listing_performance table
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "symbol" VARCHAR(20);
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "company_name" VARCHAR(255);
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "listing_date" DATE;
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "data_source" VARCHAR(50) DEFAULT 'MANUAL';
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT NOW() NOT NULL;
ALTER TABLE "listing_performance" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL;

-- This migration was applied manually first, then documented here for tracking
-- Applied: 2025-10-18 11:31 UTC
-- Context: Resolved "Failed to fetch IPO by slug" errors in NSE scraper
