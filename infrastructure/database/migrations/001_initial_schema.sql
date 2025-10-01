-- IPODhan Initial Database Schema
-- Migration: 001_initial_schema
-- Created: 2025-09-30

-- Enable PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Core IPO table
CREATE TABLE ipos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    issue_size DECIMAL(12,2),
    price_band_low DECIMAL(10,2) NOT NULL,
    price_band_high DECIMAL(10,2) NOT NULL,
    lot_size INTEGER NOT NULL,
    open_date DATE NOT NULL,
    close_date DATE NOT NULL,
    listing_date DATE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('UPCOMING', 'LIVE', 'CLOSED', 'LISTED')),
    category VARCHAR(20) NOT NULL CHECK (category IN ('MAINBOARD', 'SME')),
    registrar VARCHAR(100),
    exchange VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- IPO Scores table
CREATE TABLE ipo_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
    total_score INTEGER NOT NULL CHECK (total_score >= 0 AND total_score <= 100),
    fundamental_score INTEGER NOT NULL CHECK (fundamental_score >= 0 AND fundamental_score <= 25),
    sentiment_score INTEGER NOT NULL CHECK (sentiment_score >= 0 AND sentiment_score <= 25),
    subscription_score INTEGER NOT NULL CHECK (subscription_score >= 0 AND subscription_score <= 25),
    sector_score INTEGER NOT NULL CHECK (sector_score >= 0 AND sector_score <= 25),
    verdict VARCHAR(20) NOT NULL CHECK (verdict IN ('APPLY', 'CONSIDER', 'SKIP')),
    confidence VARCHAR(20) NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
    reasoning TEXT,
    algorithm_version VARCHAR(10) NOT NULL,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ipo_id, calculated_at)
);

-- GMP History table
CREATE TABLE gmp_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
    gmp_value DECIMAL(10,2) NOT NULL,
    gmp_percentage DECIMAL(5,2) NOT NULL,
    kostak_rate DECIMAL(10,2),
    source VARCHAR(50) NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscription Data table
CREATE TABLE subscription_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
    category VARCHAR(20) NOT NULL CHECK (category IN ('QIB', 'NII', 'RETAIL', 'EMPLOYEE')),
    subscription_times DECIMAL(10,2) NOT NULL,
    shares_offered BIGINT NOT NULL,
    shares_bid BIGINT NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    subscription_tier VARCHAR(20) DEFAULT 'FREE' CHECK (subscription_tier IN ('FREE', 'BASIC', 'PREMIUM')),
    preferences JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Watchlist table
CREATE TABLE user_watchlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, ipo_id)
);

-- API Keys table for B2B partners
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    partner_name VARCHAR(255) NOT NULL,
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('BASIC', 'STANDARD', 'ENTERPRISE')),
    rate_limit INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Performance indexes
CREATE INDEX idx_ipos_status ON ipos(status);
CREATE INDEX idx_ipos_dates ON ipos(open_date, close_date);
CREATE INDEX idx_ipos_category ON ipos(category);
CREATE INDEX idx_ipo_scores_ipo_id ON ipo_scores(ipo_id);
CREATE INDEX idx_ipo_scores_calculated ON ipo_scores(calculated_at DESC);
CREATE INDEX idx_gmp_history_ipo ON gmp_history(ipo_id, recorded_at DESC);
CREATE INDEX idx_subscription_data_ipo ON subscription_data(ipo_id, recorded_at DESC);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_user_watchlist_user ON user_watchlist(user_id);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'IPODhan initial schema created successfully';
END
$$;