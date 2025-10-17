-- Rollback Migration: Revert issue_size column precision to original NUMERIC(10,2)
-- Story: 11.2 - Database Schema Fixes & Scraper Reliability Improvements
-- Date: 2025-10-17
-- WARNING: This rollback will FAIL if any IPO has issue_size > ₹999.99 crores
--          Before rollback, ensure all large IPOs are removed or adjusted

-- Drop CHECK constraint if it exists
ALTER TABLE ipos DROP CONSTRAINT IF EXISTS ipos_issue_size_positive;

-- Revert issue_size column to original precision NUMERIC(10,2)
-- WARNING: This will truncate values > 99,999,999.99 or fail if constraint violation
ALTER TABLE ipos ALTER COLUMN issue_size TYPE NUMERIC(10, 2);

-- Note: This rollback should only be used in emergency situations
-- Recommended action: Remove/update large IPOs before running this rollback
-- Query to find large IPOs: SELECT company_name, issue_size FROM ipos WHERE issue_size > 999.99;
