-- Migration: Performance Optimization Indexes
-- Story: 8.3 - Performance Optimization
-- Purpose: Add missing indexes and optimize query performance (AC#7)

-- Add slug column if it doesn't exist (migration safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ipos' AND column_name = 'slug'
  ) THEN
    ALTER TABLE ipos ADD COLUMN slug VARCHAR(255) NOT NULL DEFAULT '';
    ALTER TABLE ipos ADD CONSTRAINT ipos_slug_unique UNIQUE(slug);
  END IF;
END $$;

-- Add registrar_id column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ipos' AND column_name = 'registrar_id'
  ) THEN
    ALTER TABLE ipos ADD COLUMN registrar_id UUID REFERENCES registrars(id);
  END IF;
END $$;

-- Add rating_override column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ipos' AND column_name = 'rating_override'
  ) THEN
    ALTER TABLE ipos ADD COLUMN rating_override BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add affiliate_clicks table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'affiliate_clicks'
  ) THEN
    CREATE TABLE affiliate_clicks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ipo_id UUID REFERENCES ipos(id) ON DELETE SET NULL,
      broker VARCHAR(50) NOT NULL,
      source VARCHAR(50) NOT NULL,
      user_session VARCHAR(255),
      clicked_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  END IF;
END $$;

-- Add performance indexes to affiliate_clicks if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'affiliate_clicks') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_affiliate_clicks_broker') THEN
      CREATE INDEX idx_affiliate_clicks_broker ON affiliate_clicks(broker);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_affiliate_clicks_clicked_at') THEN
      CREATE INDEX idx_affiliate_clicks_clicked_at ON affiliate_clicks(clicked_at DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_affiliate_clicks_ipo_id') THEN
      CREATE INDEX idx_affiliate_clicks_ipo_id ON affiliate_clicks(ipo_id);
    END IF;
  END IF;
END $$;

-- Ensure critical indexes exist (idempotent)
DO $$
BEGIN
  -- IPO status index (for filtering by status: OPEN, UPCOMING, etc.)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ipos_status') THEN
    CREATE INDEX idx_ipos_status ON ipos(status);
  END IF;

  -- IPO slug index (for detail page lookups)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ipos_slug') THEN
    CREATE INDEX idx_ipos_slug ON ipos(slug);
  END IF;

  -- Subscription IPO+timestamp composite index (for latest subscription queries)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_subscriptions_ipo_timestamp') THEN
    CREATE INDEX idx_subscriptions_ipo_timestamp ON subscriptions(ipo_id, timestamp DESC);
  END IF;

  -- GMP records IPO+timestamp composite index (for GMP history)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_gmp_records_ipo_timestamp') THEN
    CREATE INDEX idx_gmp_records_ipo_timestamp ON gmp_records(ipo_id, timestamp DESC);
  END IF;

  -- IPO company name trigram index for fuzzy search (if pg_trgm extension exists)
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ipos_company_name_trgm') THEN
      CREATE INDEX idx_ipos_company_name_trgm ON ipos USING gin(company_name gin_trgm_ops);
    END IF;
  END IF;

  -- IPO created_at index (for sorting by newest)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ipos_created_at') THEN
    CREATE INDEX idx_ipos_created_at ON ipos(created_at DESC);
  END IF;

  -- IPO open_date index (for filtering upcoming IPOs)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ipos_open_date') THEN
    CREATE INDEX idx_ipos_open_date ON ipos(open_date);
  END IF;

  -- IPO sector index (for sector filtering)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ipos_sector') THEN
    CREATE INDEX idx_ipos_sector ON ipos(sector);
  END IF;

  -- IPO category index (for category filtering: MAINBOARD, SME)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ipos_category') THEN
    CREATE INDEX idx_ipos_category ON ipos(category);
  END IF;

  -- Broker affiliates active+order composite index (for homepage broker display)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'broker_affiliates') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_broker_affiliates_active_order') THEN
      CREATE INDEX idx_broker_affiliates_active_order ON broker_affiliates(active, display_order);
    END IF;
  END IF;

  -- Market holidays date index (for holiday lookups)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'market_holidays') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_market_holidays_date') THEN
      CREATE INDEX idx_market_holidays_date ON market_holidays(date);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_market_holidays_year') THEN
      CREATE INDEX idx_market_holidays_year ON market_holidays(year);
    END IF;
  END IF;
END $$;

-- Analyze tables to update statistics for query planner
ANALYZE ipos;
ANALYZE subscriptions;
ANALYZE gmp_records;

-- Add comments for documentation
COMMENT ON INDEX idx_ipos_status IS 'Performance: Filter IPOs by status (OPEN, UPCOMING, CLOSED, LISTED)';
COMMENT ON INDEX idx_ipos_slug IS 'Performance: Fast lookup for IPO detail pages';
COMMENT ON INDEX idx_subscriptions_ipo_timestamp IS 'Performance: Latest subscription data queries';
COMMENT ON INDEX idx_gmp_records_ipo_timestamp IS 'Performance: GMP history queries';
COMMENT ON INDEX idx_ipos_company_name_trgm IS 'Performance: Fuzzy company name search';
COMMENT ON INDEX idx_ipos_created_at IS 'Performance: Sort IPOs by newest first';
COMMENT ON INDEX idx_ipos_open_date IS 'Performance: Filter upcoming IPOs by open date';
COMMENT ON INDEX idx_ipos_sector IS 'Performance: Filter IPOs by sector';
COMMENT ON INDEX idx_ipos_category IS 'Performance: Filter IPOs by category (MAINBOARD, SME)';
