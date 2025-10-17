-- Migration: Add UNIQUE constraint to ipos.slug column
-- Story: 11.2 - Database Schema Fixes & Scraper Reliability Improvements
-- Date: 2025-10-17
-- Rationale: Prevent duplicate slugs for IPO detail pages
--            Ensures each IPO has a unique URL identifier

-- First, check for any duplicate slugs and handle them
-- Query to find duplicates: SELECT slug, COUNT(*) FROM ipos GROUP BY slug HAVING COUNT(*) > 1;

-- Add UNIQUE constraint to slug column
-- Note: This will fail if duplicate slugs exist - they must be resolved first
ALTER TABLE ipos ADD CONSTRAINT ipos_slug_unique UNIQUE (slug);

-- The constraint is already defined in the schema at line 101:
-- slug: varchar('slug', { length: 255 }).notNull().unique()
-- This migration ensures the constraint exists in the database
