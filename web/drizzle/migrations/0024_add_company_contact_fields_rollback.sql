-- Rollback Migration: Add Company Contact Information Fields
-- Description: Removes 9 company contact information columns from ipo_details
-- Epic: Epic 11
-- Story: 11.14
-- Created: 2025-10-26

-- Remove company contact information columns
ALTER TABLE ipo_details
  DROP COLUMN IF EXISTS company_address,
  DROP COLUMN IF EXISTS company_phone,
  DROP COLUMN IF EXISTS company_email,
  DROP COLUMN IF EXISTS company_city,
  DROP COLUMN IF EXISTS company_state,
  DROP COLUMN IF EXISTS company_pincode,
  DROP COLUMN IF EXISTS compliance_officer,
  DROP COLUMN IF EXISTS compliance_officer_phone,
  DROP COLUMN IF EXISTS compliance_officer_email;
