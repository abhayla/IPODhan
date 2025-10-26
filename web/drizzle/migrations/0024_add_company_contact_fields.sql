-- Migration: Add Company Contact Information Fields to ipo_details
-- Description: Adds 9 new columns for company contact information display
-- Epic: Epic 11
-- Story: 11.14
-- Created: 2025-10-26

-- Add 9 company contact information columns
ALTER TABLE ipo_details
  ADD COLUMN IF NOT EXISTS company_address TEXT,
  ADD COLUMN IF NOT EXISTS company_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS company_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_pincode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS compliance_officer VARCHAR(255),
  ADD COLUMN IF NOT EXISTS compliance_officer_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS compliance_officer_email VARCHAR(255);

-- Add comments for documentation
COMMENT ON COLUMN ipo_details.company_address IS 'Registered office address from DRHP (Story 11.14)';
COMMENT ON COLUMN ipo_details.company_phone IS 'Primary contact phone number (Story 11.14)';
COMMENT ON COLUMN ipo_details.company_email IS 'Primary investor relations email (Story 11.14)';
COMMENT ON COLUMN ipo_details.company_city IS 'City for registered office address (Story 11.14)';
COMMENT ON COLUMN ipo_details.company_state IS 'State for registered office address (Story 11.14)';
COMMENT ON COLUMN ipo_details.company_pincode IS 'Pincode for registered office address (Story 11.14)';
COMMENT ON COLUMN ipo_details.compliance_officer IS 'Compliance officer name from DRHP (Story 11.14)';
COMMENT ON COLUMN ipo_details.compliance_officer_phone IS 'Compliance officer phone number (Story 11.14)';
COMMENT ON COLUMN ipo_details.compliance_officer_email IS 'Compliance officer email address (Story 11.14)';
