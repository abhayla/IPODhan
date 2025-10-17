-- Migration: Increase issue_size column precision to support large-cap IPOs
-- Story: 11.2 - Database Schema Fixes & Scraper Reliability Improvements
-- Date: 2025-10-17
-- Rationale: Current NUMERIC(10,2) limits issue_size to ₹999.99 crores
--            Blocking 31 large-cap IPOs (largest: Canara HSBC at ₹25,175 crores)
--            New NUMERIC(15,2) supports up to ₹999,999 crores (₹9,999.99 billion)

-- Alter issue_size column to increase precision from NUMERIC(10,2) to NUMERIC(15,2)
ALTER TABLE ipos ALTER COLUMN issue_size TYPE NUMERIC(15, 2);

-- Optional: Add CHECK constraint to ensure non-negative values
ALTER TABLE ipos ADD CONSTRAINT ipos_issue_size_positive CHECK (issue_size >= 0);

-- Note: This migration is non-destructive and preserves all existing data
-- Rollback procedure available in: 0011_increase_issue_size_limit_rollback.sql
