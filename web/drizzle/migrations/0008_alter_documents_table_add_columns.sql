-- Migration: Add exchange, created_at, updated_at columns to documents table
-- Story 7.9: Prospectus Documents Scraper Implementation
-- Date: 2025-10-13

-- Add new columns to documents table
ALTER TABLE documents ADD COLUMN IF NOT EXISTS exchange VARCHAR(10);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW() NOT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW() NOT NULL;

-- Add unique constraint on URL to prevent duplicate documents
ALTER TABLE documents ADD CONSTRAINT documents_url_unique UNIQUE (url);

-- Add index for exchange column for filtering
CREATE INDEX IF NOT EXISTS idx_documents_exchange ON documents(exchange);

-- Update existing rows to have created_at and updated_at values
UPDATE documents SET created_at = uploaded_at, updated_at = uploaded_at WHERE created_at IS NULL;
