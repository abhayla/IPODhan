-- Migration: Add performance indexes for query optimization
-- Purpose: Optimize slow queries across all API endpoints
-- Target: Phase 5 Performance Optimization - Meet p95 < 500ms for all endpoints

-- ==================== IPO TABLE INDEXES ====================

-- Composite index for status + segment filtering (most common query pattern)
-- Improves: /api/ipos?status=OPEN&segment=MAINBOARD
CREATE INDEX IF NOT EXISTS idx_ipos_status_segment
  ON ipos(status, segment)
  WHERE status IS NOT NULL AND segment IS NOT NULL;

-- Composite index for status + offering_type filtering
-- Improves: /api/ipos?status=LISTED&offeringType=IPO
CREATE INDEX IF NOT EXISTS idx_ipos_status_offering_type
  ON ipos(status, offering_type)
  WHERE status IS NOT NULL;

-- Composite index for date range queries (calendar, history)
-- Improves: Date-based filtering in calendar and historical IPO views
CREATE INDEX IF NOT EXISTS idx_ipos_dates
  ON ipos(open_date DESC, close_date DESC, listing_date DESC)
  WHERE open_date IS NOT NULL OR close_date IS NOT NULL OR listing_date IS NOT NULL;

-- Index on slug for detail page lookups (if not exists)
-- Improves: /api/ipos/[slug]
CREATE INDEX IF NOT EXISTS idx_ipos_slug
  ON ipos(slug);

-- Index on sector for sector-based filtering
-- Improves: /api/ipos?sector=Technology
CREATE INDEX IF NOT EXISTS idx_ipos_sector
  ON ipos(sector)
  WHERE sector IS NOT NULL;

-- Index on created_at for sorting (default sort field)
-- Improves: Default sorting in /api/ipos
CREATE INDEX IF NOT EXISTS idx_ipos_created_at
  ON ipos(created_at DESC);

-- Index on issue_size for sorting by size
-- Improves: /api/ipos?sortBy=issueSize
CREATE INDEX IF NOT EXISTS idx_ipos_issue_size
  ON ipos(issue_size DESC)
  WHERE issue_size IS NOT NULL;

-- ==================== FOREIGN KEY INDEXES ====================

-- Financial data: Index on ipo_id for JOIN optimization
-- Improves: All queries that join ipos with financial_data
CREATE INDEX IF NOT EXISTS idx_financial_data_ipo_id
  ON financial_data(ipo_id);

-- Subscriptions: Index on ipo_id for JOIN optimization
-- Improves: Subscription history queries and latest snapshot retrieval
CREATE INDEX IF NOT EXISTS idx_subscriptions_ipo_id
  ON subscriptions(ipo_id);

-- Subscriptions: Composite index for latest snapshot queries
-- Improves: Getting latest subscription per IPO
CREATE INDEX IF NOT EXISTS idx_subscriptions_ipo_recorded
  ON subscriptions(ipo_id, timestamp DESC);

-- GMP Records: Index on ipo_id for JOIN optimization
-- Improves: GMP history queries and latest GMP retrieval
CREATE INDEX IF NOT EXISTS idx_gmp_records_ipo_id
  ON gmp_records(ipo_id);

-- GMP Records: Composite index for latest GMP queries
-- Improves: Getting latest GMP per IPO
CREATE INDEX IF NOT EXISTS idx_gmp_records_ipo_recorded
  ON gmp_records(ipo_id, timestamp DESC);

-- Listing Performance: Index on ipo_id (one-to-one relationship)
-- Improves: Joining listing performance data
CREATE INDEX IF NOT EXISTS idx_listing_performance_ipo_id
  ON listing_performance(ipo_id);

-- Documents: Index on ipo_id for document retrieval
-- Improves: /api/ipos/[slug]/documents
CREATE INDEX IF NOT EXISTS idx_documents_ipo_id
  ON documents(ipo_id);

-- IPO Details: Index on ipo_id (one-to-one relationship - Story 4.12)
-- Improves: Extended timeline date queries in calendar
CREATE INDEX IF NOT EXISTS idx_ipo_details_ipo_id
  ON ipo_details(ipo_id);

-- IPO Reviews: Index on ipo_id for review retrieval
-- Improves: /api/ipos/[slug]/reviews
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_ipo_id
  ON ipo_reviews(ipo_id);

-- Peer Companies: Index on ipo_id for peer comparison
-- Improves: /api/peer-companies/[ipoId]
CREATE INDEX IF NOT EXISTS idx_peer_companies_ipo_id
  ON peer_companies(ipo_id);

-- ==================== REFERENCE DATA INDEXES ====================

-- Market Holidays: Index on date for quick date lookups
-- Improves: /api/market-holidays
CREATE INDEX IF NOT EXISTS idx_market_holidays_date
  ON market_holidays(date DESC);

-- Registrars: Index on name for search
-- Improves: /api/registrars
CREATE INDEX IF NOT EXISTS idx_registrars_name
  ON registrars(name);

-- ==================== SCRAPER MONITORING INDEXES ====================

-- Scraper Logs: Index on created_at for recent logs retrieval
-- Improves: /api/admin/scraper/logs
CREATE INDEX IF NOT EXISTS idx_scraper_logs_created_at
  ON scraper_logs(created_at DESC);

-- Scraper Logs: Index on status for filtering by success/failure
-- Improves: Scraper monitoring and error tracking
CREATE INDEX IF NOT EXISTS idx_scraper_logs_status
  ON scraper_logs(status);

-- Scraper Logs: Composite index for source + status queries
-- Improves: /api/admin/scraper/status
CREATE INDEX IF NOT EXISTS idx_scraper_logs_source_status
  ON scraper_logs(source, status, created_at DESC);

-- ==================== AFFILIATE TRACKING INDEXES ====================

-- Affiliate Clicks: Index on broker_id for click aggregation
-- Improves: Affiliate click tracking and reporting
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_broker_id
  ON affiliate_clicks(broker_id);

-- Affiliate Clicks: Index on created_at for time-based reporting
-- Improves: Daily/weekly click reports
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_created_at
  ON affiliate_clicks(created_at DESC);

-- ==================== ANALYZE FOR STATISTICS ====================

-- Update table statistics for query planner optimization
ANALYZE ipos;
ANALYZE financial_data;
ANALYZE subscriptions;
ANALYZE gmp_records;
ANALYZE listing_performance;
ANALYZE documents;
ANALYZE ipo_details;
ANALYZE market_holidays;
ANALYZE registrars;
ANALYZE scraper_logs;

-- ==================== COMMENTS ====================

COMMENT ON INDEX idx_ipos_status_segment IS
  'Composite index for filtering IPOs by status and segment - most common query pattern';

COMMENT ON INDEX idx_ipos_dates IS
  'Composite index for date-based queries - calendar and historical views';

COMMENT ON INDEX idx_subscriptions_ipo_recorded IS
  'Composite index for latest subscription snapshot retrieval per IPO';

COMMENT ON INDEX idx_gmp_records_ipo_recorded IS
  'Composite index for latest GMP record retrieval per IPO';
