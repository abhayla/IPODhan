-- IPODhan Database Schema
-- PostgreSQL 16

-- ============================================
-- Table: ipos
-- Stores core IPO information
-- ============================================
CREATE TABLE IF NOT EXISTS ipos (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL UNIQUE,
    company_name VARCHAR(255) NOT NULL,

    -- Issue Details
    issue_size_crores DECIMAL(10, 2),
    price_band_min DECIMAL(10, 2),
    price_band_max DECIMAL(10, 2),
    lot_size INTEGER,

    -- Dates
    open_date DATE,
    close_date DATE,
    allotment_date DATE,
    listing_date DATE,

    -- Categories
    ipo_type VARCHAR(20) CHECK (ipo_type IN ('Mainboard', 'SME')),
    sector VARCHAR(100),

    -- Company Info
    company_description TEXT,
    registrar VARCHAR(255),
    lead_managers TEXT, -- Comma-separated list

    -- Documents
    drhp_url TEXT,
    rhp_url TEXT,
    prospectus_url TEXT,

    -- Status
    status VARCHAR(20) CHECK (status IN ('Upcoming', 'Open', 'Closed', 'Listed')) DEFAULT 'Upcoming',

    -- Listing Performance
    issue_price DECIMAL(10, 2),
    listing_price DECIMAL(10, 2),
    listing_gain_percent DECIMAL(6, 2),
    current_price DECIMAL(10, 2),

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT valid_price_band CHECK (price_band_min <= price_band_max)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_ipos_status ON ipos(status);
CREATE INDEX IF NOT EXISTS idx_ipos_open_date ON ipos(open_date);
CREATE INDEX IF NOT EXISTS idx_ipos_listing_date ON ipos(listing_date);
CREATE INDEX IF NOT EXISTS idx_ipos_sector ON ipos(sector);
CREATE INDEX IF NOT EXISTS idx_ipos_type ON ipos(ipo_type);

-- ============================================
-- Table: subscription_data
-- Stores real-time subscription status
-- ============================================
CREATE TABLE IF NOT EXISTS subscription_data (
    id SERIAL PRIMARY KEY,
    ipo_id INTEGER NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,

    -- Subscription Times (in times subscribed)
    qib_times DECIMAL(6, 2), -- Qualified Institutional Buyers
    nii_times DECIMAL(6, 2), -- Non-Institutional Investors
    retail_times DECIMAL(6, 2), -- Retail Individual Investors
    employee_times DECIMAL(6, 2), -- Employee Reservation
    total_times DECIMAL(6, 2),

    -- Applications
    total_applications INTEGER,

    -- Timestamp
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraint
    CONSTRAINT unique_ipo_timestamp UNIQUE(ipo_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_subscription_ipo_id ON subscription_data(ipo_id);
CREATE INDEX IF NOT EXISTS idx_subscription_recorded_at ON subscription_data(recorded_at);

-- ============================================
-- Table: gmp_data
-- Stores Grey Market Premium tracking
-- ============================================
CREATE TABLE IF NOT EXISTS gmp_data (
    id SERIAL PRIMARY KEY,
    ipo_id INTEGER NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,

    -- GMP Info
    gmp_price DECIMAL(10, 2), -- Premium in rupees
    gmp_percent DECIMAL(6, 2), -- Premium as percentage
    subject_to_sauda BOOLEAN DEFAULT false,

    -- Expected listing price
    expected_listing_price DECIMAL(10, 2),

    -- Source & Timestamp
    source VARCHAR(100),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gmp_ipo_id ON gmp_data(ipo_id);
CREATE INDEX IF NOT EXISTS idx_gmp_recorded_at ON gmp_data(recorded_at);

-- ============================================
-- Table: ipo_financials
-- Stores key financial metrics
-- ============================================
CREATE TABLE IF NOT EXISTS ipo_financials (
    id SERIAL PRIMARY KEY,
    ipo_id INTEGER NOT NULL UNIQUE REFERENCES ipos(id) ON DELETE CASCADE,

    -- Valuation Metrics
    face_value DECIMAL(10, 2),
    market_cap_crores DECIMAL(12, 2),
    pe_ratio DECIMAL(8, 2),
    industry_pe DECIMAL(8, 2),
    price_to_book DECIMAL(8, 2),

    -- Revenue & Profit (Latest FY, in crores)
    revenue_crores DECIMAL(12, 2),
    profit_crores DECIMAL(12, 2),
    net_worth_crores DECIMAL(12, 2),

    -- Additional metrics
    roce_percent DECIMAL(6, 2), -- Return on Capital Employed
    ronw_percent DECIMAL(6, 2), -- Return on Net Worth

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Table: ipo_reservations
-- Stores quota/reservation breakdown
-- ============================================
CREATE TABLE IF NOT EXISTS ipo_reservations (
    id SERIAL PRIMARY KEY,
    ipo_id INTEGER NOT NULL UNIQUE REFERENCES ipos(id) ON DELETE CASCADE,

    -- Reservation Percentages
    qib_percent DECIMAL(5, 2),
    nii_percent DECIMAL(5, 2),
    retail_percent DECIMAL(5, 2),
    employee_percent DECIMAL(5, 2),
    shareholder_percent DECIMAL(5, 2),

    -- Additional Info
    anchor_portion_percent DECIMAL(5, 2),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Table: email_subscribers
-- Stores user email subscriptions for alerts
-- ============================================
CREATE TABLE IF NOT EXISTS email_subscribers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,

    -- Subscription Preferences
    subscribe_new_ipo BOOLEAN DEFAULT true,
    subscribe_opening_reminder BOOLEAN DEFAULT true,
    subscribe_closing_reminder BOOLEAN DEFAULT true,
    subscribe_allotment BOOLEAN DEFAULT false,
    subscribe_listing BOOLEAN DEFAULT false,

    -- Status
    is_verified BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    verification_token VARCHAR(100),

    -- Metadata
    subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_email_sent_at TIMESTAMP,

    -- Constraints
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX IF NOT EXISTS idx_email_subscribers_active ON email_subscribers(is_active);
CREATE INDEX IF NOT EXISTS idx_email_subscribers_verified ON email_subscribers(is_verified);

-- ============================================
-- Table: ipo_ratings
-- Stores IPO ratings/scores
-- ============================================
CREATE TABLE IF NOT EXISTS ipo_ratings (
    id SERIAL PRIMARY KEY,
    ipo_id INTEGER NOT NULL UNIQUE REFERENCES ipos(id) ON DELETE CASCADE,

    -- Rating (1-5 scale or Buy/Hold/Avoid)
    rating_score DECIMAL(3, 2) CHECK (rating_score >= 1 AND rating_score <= 5),
    rating_label VARCHAR(20) CHECK (rating_label IN ('Buy', 'Hold', 'Avoid')),

    -- Scoring Components (weighted)
    subscription_score DECIMAL(3, 2),
    valuation_score DECIMAL(3, 2),
    gmp_score DECIMAL(3, 2),
    fundamentals_score DECIMAL(3, 2),

    -- Rationale
    rating_rationale TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Table: data_sync_log
-- Tracks data synchronization status
-- ============================================
CREATE TABLE IF NOT EXISTS data_sync_log (
    id SERIAL PRIMARY KEY,
    sync_type VARCHAR(50) NOT NULL, -- 'NSE', 'BSE', 'GMP', 'Subscription', etc.
    status VARCHAR(20) CHECK (status IN ('Success', 'Failed', 'Partial')),
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_log_type ON data_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_sync_log_started ON data_sync_log(started_at);

-- ============================================
-- Function: Update timestamp on row modification
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_ipos_updated_at
    BEFORE UPDATE ON ipos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ipo_financials_updated_at
    BEFORE UPDATE ON ipo_financials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ipo_ratings_updated_at
    BEFORE UPDATE ON ipo_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Views for common queries
-- ============================================

-- View: Current/Upcoming IPOs with latest subscription data
CREATE OR REPLACE VIEW v_active_ipos AS
SELECT
    i.*,
    s.qib_times, s.nii_times, s.retail_times, s.total_times,
    g.gmp_price, g.gmp_percent, g.expected_listing_price,
    r.rating_score, r.rating_label
FROM ipos i
LEFT JOIN LATERAL (
    SELECT * FROM subscription_data
    WHERE ipo_id = i.id
    ORDER BY recorded_at DESC
    LIMIT 1
) s ON true
LEFT JOIN LATERAL (
    SELECT * FROM gmp_data
    WHERE ipo_id = i.id
    ORDER BY recorded_at DESC
    LIMIT 1
) g ON true
LEFT JOIN ipo_ratings r ON r.ipo_id = i.id
WHERE i.status IN ('Upcoming', 'Open', 'Closed')
ORDER BY i.open_date DESC;

-- View: Listed IPOs with performance metrics
CREATE OR REPLACE VIEW v_listed_ipos AS
SELECT
    i.id, i.symbol, i.company_name, i.sector,
    i.issue_price, i.listing_price, i.listing_gain_percent,
    i.current_price,
    ROUND(((i.current_price - i.issue_price) / i.issue_price * 100), 2) as current_gain_percent,
    i.listing_date, i.open_date, i.close_date
FROM ipos i
WHERE i.status = 'Listed' AND i.listing_date IS NOT NULL
ORDER BY i.listing_date DESC;

-- ============================================
-- Seed Data (Sample)
-- ============================================
-- Uncomment to insert sample data for testing
/*
INSERT INTO ipos (symbol, company_name, issue_size_crores, price_band_min, price_band_max, lot_size, open_date, close_date, ipo_type, sector, status, company_description)
VALUES
('SAMPLE', 'Sample IPO Company Ltd', 500.00, 95.00, 100.00, 150, '2025-01-15', '2025-01-17', 'Mainboard', 'Technology', 'Upcoming', 'Sample company description for testing purposes.');
*/
