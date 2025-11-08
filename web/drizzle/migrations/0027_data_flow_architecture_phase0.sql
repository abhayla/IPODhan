-- Migration: Phase 0 - Data Flow Architecture Fix
-- Description: Add field source tracking, conflict detection, and DRHP extraction tracking
-- Date: 2025-11-07

-- ==================== STEP 1: Enhance scraper_source enum ====================
-- Add new source types for data flow tracking
-- Note: PostgreSQL requires specific syntax for adding enum values

DO $$
BEGIN
    -- Add ADMIN source (highest priority - manual admin edits)
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'ADMIN'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source')
    ) THEN
        ALTER TYPE scraper_source ADD VALUE 'ADMIN';
    END IF;

    -- Add DRHP source (authoritative for financial data)
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'DRHP'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source')
    ) THEN
        ALTER TYPE scraper_source ADD VALUE 'DRHP';
    END IF;
END $$;

-- ==================== STEP 2: Enhance documents table for DRHP extraction ====================
-- Add extraction tracking fields to monitor PDF extraction status

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS extraction_error TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0 NOT NULL;

-- Add index for querying by extraction status
CREATE INDEX IF NOT EXISTS idx_documents_extraction_status ON documents(extraction_status);

-- Add comment for documentation
COMMENT ON COLUMN documents.extraction_status IS 'PENDING|IN_PROGRESS|COMPLETED|FAILED|MANUAL_REVIEW';
COMMENT ON COLUMN documents.extraction_confidence IS 'Confidence score 0-100% from DRHP extraction';
COMMENT ON COLUMN documents.retry_count IS 'Number of extraction attempts (max 3)';

-- ==================== STEP 3: Create field_sources table ====================
-- Tracks which scraper source provided each field value

CREATE TABLE IF NOT EXISTS field_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
    table_name VARCHAR(100) NOT NULL,
    field_name VARCHAR(100) NOT NULL,

    -- Source tracking
    source scraper_source NOT NULL,
    confidence INTEGER DEFAULT 100 NOT NULL CHECK (confidence >= 0 AND confidence <= 100),

    -- Change history
    previous_value TEXT,
    previous_source scraper_source,

    -- Data lineage (structured metadata)
    data_lineage JSONB,

    -- Timestamps
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Unique constraint: one source record per field per IPO
    CONSTRAINT unique_field_source_per_ipo UNIQUE(ipo_id, table_name, field_name)
);

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_field_sources_ipo_id ON field_sources(ipo_id);
CREATE INDEX IF NOT EXISTS idx_field_sources_table_name ON field_sources(table_name);
CREATE INDEX IF NOT EXISTS idx_field_sources_field_name ON field_sources(field_name);
CREATE INDEX IF NOT EXISTS idx_field_sources_source ON field_sources(source);

-- Composite index for common queries (which source provided which field for this IPO?)
CREATE INDEX IF NOT EXISTS idx_field_sources_ipo_table_field
    ON field_sources(ipo_id, table_name, field_name);

-- Add comments
COMMENT ON TABLE field_sources IS 'Audit trail: tracks which scraper source provided each field value';
COMMENT ON COLUMN field_sources.confidence IS 'Data quality score 0-100 based on source reliability';
COMMENT ON COLUMN field_sources.data_lineage IS 'JSON metadata: {method: "API"|"SCRAPE", endpoint: "/xyz", confidence: 95}';

-- ==================== STEP 4: Create data_conflicts table ====================
-- Logs detected conflicts between scraper sources for admin review

CREATE TABLE IF NOT EXISTS data_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
    table_name VARCHAR(100) NOT NULL,
    field_name VARCHAR(100) NOT NULL,

    -- Conflicting sources
    source1 scraper_source NOT NULL,
    value1 TEXT,
    source2 scraper_source NOT NULL,
    value2 TEXT,

    -- Resolution
    resolved_source scraper_source,
    resolution_reason VARCHAR(100),
    severity VARCHAR(20) DEFAULT 'INFO' NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),

    -- Admin resolution
    admin_note TEXT,
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(255),

    -- Timestamps
    detected_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_data_conflicts_ipo_id ON data_conflicts(ipo_id);
CREATE INDEX IF NOT EXISTS idx_data_conflicts_field_name ON data_conflicts(field_name);
CREATE INDEX IF NOT EXISTS idx_data_conflicts_severity ON data_conflicts(severity);
CREATE INDEX IF NOT EXISTS idx_data_conflicts_detected_at ON data_conflicts(detected_at DESC);

-- Unresolved conflicts index (most important query for admin dashboard)
CREATE INDEX IF NOT EXISTS idx_data_conflicts_unresolved ON data_conflicts(resolved_at)
    WHERE resolved_at IS NULL;

-- Composite index for conflict dashboard (IPO-specific unresolved conflicts)
CREATE INDEX IF NOT EXISTS idx_data_conflicts_ipo_unresolved
    ON data_conflicts(ipo_id, resolved_at);

-- Add comments
COMMENT ON TABLE data_conflicts IS 'Logs every data conflict between scrapers for admin review and audit';
COMMENT ON COLUMN data_conflicts.severity IS 'INFO: minor differences, WARNING: significant differences, CRITICAL: major discrepancies';
COMMENT ON COLUMN data_conflicts.resolution_reason IS 'SOURCE_PRIORITY|ADMIN_CHOICE|CONFIDENCE_SCORE|FIELD_PROTECTION';

-- ==================== VERIFICATION QUERIES ====================
-- Run these to verify migration success:

-- 1. Verify enum values
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source') ORDER BY enumsortorder;

-- 2. Verify documents table columns
-- SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'documents' AND column_name LIKE 'extraction%';

-- 3. Verify new tables exist
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('field_sources', 'data_conflicts');

-- 4. Verify indexes created
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('documents', 'field_sources', 'data_conflicts') ORDER BY tablename, indexname;

-- ==================== MIGRATION COMPLETE ====================
-- Phase 0: Foundation infrastructure for Data Flow Architecture Fix
-- Next steps: Create repositories, implement consolidation service, build admin dashboard
