-- IPODhan Enhanced IPO Data Schema
-- Migration: 002_enhanced_ipo_schema
-- Created: 2025-10-01
-- Purpose: Extend schema for comprehensive IPO tracking with financial metrics and enhanced GMP tracking

-- ============================================================================
-- 1. IPO DETAILS TABLE - Extended IPO information
-- ============================================================================
CREATE TABLE ipo_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,

    -- Identifiers
    isin VARCHAR(12) UNIQUE,

    -- Company Information
    company_description TEXT,

    -- Issue Details
    issue_type VARCHAR(20) CHECK (issue_type IN ('BOOK_BUILDING', 'FIXED_PRICE', 'HYBRID')),
    fresh_issue DECIMAL(12,2),  -- Amount in crores
    ofs_issue DECIMAL(12,2),    -- Offer for Sale in crores

    -- Price Information
    cut_off_price DECIMAL(10,2),
    face_value DECIMAL(10,2),
    min_investment DECIMAL(12,2),

    -- Extended Dates
    basis_of_allotment_date DATE,
    initiation_of_refunds_date DATE,
    credit_of_shares_date DATE,

    -- Registrar Information
    registrar_link VARCHAR(500),

    -- Lead Managers
    lead_managers TEXT[],  -- Array of lead manager names

    -- Exchange Information
    exchanges TEXT[] DEFAULT ARRAY['NSE', 'BSE'],  -- Can list on multiple exchanges

    -- Data Quality Tracking
    data_source VARCHAR(50) NOT NULL,  -- 'NSE', 'BSE', 'MANUAL'
    last_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Ensure one details record per IPO
    UNIQUE(ipo_id)
);

-- ============================================================================
-- 2. IPO FINANCIALS TABLE - Revenue, profit, and key ratios
-- ============================================================================
CREATE TABLE ipo_financials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,

    -- Revenue Data (last 3 financial years in crores)
    revenue_fy1 DECIMAL(12,2),
    revenue_fy2 DECIMAL(12,2),
    revenue_fy3 DECIMAL(12,2),

    -- Profit Data (last 3 financial years in crores)
    profit_fy1 DECIMAL(12,2),
    profit_fy2 DECIMAL(12,2),
    profit_fy3 DECIMAL(12,2),

    -- Key Financial Ratios
    pe_ratio DECIMAL(8,2),           -- Price to Earnings
    pb_ratio DECIMAL(8,2),           -- Price to Book
    roe_percentage DECIMAL(5,2),     -- Return on Equity
    roce_percentage DECIMAL(5,2),    -- Return on Capital Employed
    debt_to_equity DECIMAL(8,2),     -- Debt to Equity ratio

    -- Industry Comparison
    industry_pe DECIMAL(8,2),        -- Industry average PE
    peer_companies TEXT[],           -- Array of peer company names

    -- Financial Year Reference
    financial_year_end VARCHAR(10),  -- Format: 'FY2024', 'FY2023', etc.

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Ensure one financials record per IPO
    UNIQUE(ipo_id)
);

-- ============================================================================
-- 3. GMP TRACKING TABLE - Enhanced GMP with multiple sources and confidence
-- ============================================================================
CREATE TABLE gmp_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,

    -- GMP Data
    gmp_amount DECIMAL(10,2) NOT NULL,           -- Absolute GMP value
    gmp_percentage DECIMAL(5,2) NOT NULL,        -- GMP as percentage of price band
    expected_listing_price DECIMAL(10,2),        -- Calculated expected listing price

    -- Grey Market Application Pricing
    kostak_rate DECIMAL(10,2),                   -- Application selling rate (without allotment)
    subject_to_sauda DECIMAL(10,2),              -- Price with allotment guarantee

    -- Source Tracking
    source VARCHAR(50) NOT NULL CHECK (source IN ('IPOWATCH', 'INVESTORGAIN', 'CHITTORGARH', 'MANUAL')),
    source_url VARCHAR(500),
    confidence_score INTEGER NOT NULL CHECK (confidence_score >= 1 AND confidence_score <= 100),

    -- Timestamp
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Index for time-series queries
    CONSTRAINT gmp_tracking_check_positive_gmp CHECK (gmp_amount >= 0)
);

-- ============================================================================
-- 4. PIPELINE STATUS TABLE - Monitoring scraper health
-- ============================================================================
CREATE TABLE pipeline_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Pipeline Identification
    source VARCHAR(50) NOT NULL CHECK (source IN ('NSE', 'BSE', 'IPOWATCH', 'INVESTORGAIN', 'CHITTORGARH')),
    pipeline_type VARCHAR(20) NOT NULL CHECK (pipeline_type IN ('IPO_DATA', 'GMP_DATA')),

    -- Status Tracking
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE', 'RUNNING')),
    last_run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_success_at TIMESTAMP,
    consecutive_failures INTEGER DEFAULT 0,

    -- Execution Metrics
    records_processed INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    execution_time_ms INTEGER,

    -- Error Information
    error_message TEXT,
    error_details JSONB,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Ensure one status record per source-type combination (will be updated)
    UNIQUE(source, pipeline_type)
);

-- ============================================================================
-- 5. MATERIALIZED VIEW - Current GMP Aggregates
-- ============================================================================
CREATE MATERIALIZED VIEW gmp_current AS
SELECT
    ipo_id,

    -- Aggregate GMP metrics across sources
    AVG(gmp_amount) as avg_gmp_amount,
    MAX(gmp_amount) as max_gmp_amount,
    MIN(gmp_amount) as min_gmp_amount,

    AVG(gmp_percentage) as avg_gmp_percentage,
    MAX(gmp_percentage) as max_gmp_percentage,
    MIN(gmp_percentage) as min_gmp_percentage,

    -- Expected listing price (average across sources)
    AVG(expected_listing_price) as avg_expected_listing_price,

    -- Kostak and Sauda rates (average across sources)
    AVG(kostak_rate) as avg_kostak_rate,
    AVG(subject_to_sauda) as avg_subject_to_sauda,

    -- Confidence metrics
    AVG(confidence_score) as avg_confidence_score,

    -- Source tracking
    ARRAY_AGG(DISTINCT source) as sources,
    COUNT(*) as total_records,

    -- Last update timestamp (most recent record)
    MAX(recorded_at) as last_updated_at

FROM gmp_tracking
WHERE recorded_at >= NOW() - INTERVAL '24 hours'  -- Only consider last 24 hours for current view
GROUP BY ipo_id;

-- Create unique index on materialized view for efficient refresh
CREATE UNIQUE INDEX idx_gmp_current_ipo_id ON gmp_current(ipo_id);

-- ============================================================================
-- 6. PERFORMANCE INDEXES
-- ============================================================================

-- IPO Details indexes
CREATE INDEX idx_ipo_details_isin ON ipo_details(isin);
CREATE INDEX idx_ipo_details_ipo_id ON ipo_details(ipo_id);
CREATE INDEX idx_ipo_details_data_source ON ipo_details(data_source);

-- IPO Financials indexes
CREATE INDEX idx_ipo_financials_ipo_id ON ipo_financials(ipo_id);

-- GMP Tracking indexes (critical for time-series queries)
CREATE INDEX idx_gmp_tracking_ipo_time ON gmp_tracking(ipo_id, recorded_at DESC);
CREATE INDEX idx_gmp_tracking_source ON gmp_tracking(source);
CREATE INDEX idx_gmp_tracking_recorded_at ON gmp_tracking(recorded_at DESC);

-- Pipeline Status indexes
CREATE INDEX idx_pipeline_status_source ON pipeline_status(source);
CREATE INDEX idx_pipeline_status_last_run ON pipeline_status(last_run_at DESC);

-- ============================================================================
-- 7. UPDATE EXISTING IPOS TABLE INDEXES (from AC Story 1.2)
-- ============================================================================

-- Add index for status queries (if not already exists from migration 001)
CREATE INDEX IF NOT EXISTS idx_ipo_details_status ON ipos(status);

-- Add index for date range queries (if not already exists from migration 001)
CREATE INDEX IF NOT EXISTS idx_ipo_details_dates ON ipos(open_date, close_date);

-- ============================================================================
-- 8. TRIGGERS FOR AUTOMATIC TIMESTAMP UPDATES
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for ipo_details
CREATE TRIGGER update_ipo_details_updated_at
    BEFORE UPDATE ON ipo_details
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for ipo_financials
CREATE TRIGGER update_ipo_financials_updated_at
    BEFORE UPDATE ON ipo_financials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 9. HELPER FUNCTIONS
-- ============================================================================

-- Function to refresh GMP materialized view
CREATE OR REPLACE FUNCTION refresh_gmp_current_view()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY gmp_current;
    RAISE NOTICE 'GMP current view refreshed successfully at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to calculate data freshness status
CREATE OR REPLACE FUNCTION get_data_freshness_status(last_updated TIMESTAMP)
RETURNS VARCHAR AS $$
BEGIN
    IF last_updated >= NOW() - INTERVAL '1 hour' THEN
        RETURN 'GREEN';
    ELSIF last_updated >= NOW() - INTERVAL '3 hours' THEN
        RETURN 'YELLOW';
    ELSE
        RETURN 'RED';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. SAMPLE DATA QUALITY QUERIES (for monitoring dashboard)
-- ============================================================================

-- View: Pipeline Health Summary
CREATE OR REPLACE VIEW pipeline_health_summary AS
SELECT
    source,
    pipeline_type,
    status,
    last_success_at,
    consecutive_failures,
    get_data_freshness_status(last_success_at) as freshness_status,
    records_processed,
    execution_time_ms
FROM pipeline_status
ORDER BY last_run_at DESC;

-- ============================================================================
-- Success Message
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'IPODhan enhanced schema (002_enhanced_ipo_schema) created successfully';
    RAISE NOTICE 'Tables created: ipo_details, ipo_financials, gmp_tracking, pipeline_status';
    RAISE NOTICE 'Materialized view created: gmp_current';
    RAISE NOTICE 'Helper functions created: refresh_gmp_current_view(), get_data_freshness_status()';
END
$$;
