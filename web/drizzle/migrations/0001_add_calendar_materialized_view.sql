-- Migration: Add materialized view for calendar optimization
-- Purpose: Improve /api/calendar/[category] endpoint performance from 4.3s to <400ms
-- Target: Phase 5 Performance Optimization - Calendar endpoint is 10.8x over target

-- ==================== CREATE MATERIALIZED VIEW ====================

-- Materialized view combining IPO data with all related tables for calendar display
-- This pre-joins data to avoid expensive JOIN operations on every API call
CREATE MATERIALIZED VIEW calendar_view AS
SELECT
  i.id,
  i.company_name,
  i.slug,
  i.segment,
  i.offering_type,
  i.status,
  i.open_date,
  i.close_date,
  i.listing_date,
  i.price_band_lower,
  i.price_band_upper,
  i.lot_size,
  i.issue_size,
  i.issue_price,
  i.sector,
  i.logo_url,
  i.created_at,
  -- Financial data (one-to-one)
  f.revenue,
  f.profit,
  f.roe,
  f.roce,
  f.pe_ratio,
  -- Latest subscription data (one-to-many, get most recent)
  s.retail_times,
  s.nii_times,
  s.qib_times,
  s.total_times,
  s.recorded_at as subscription_recorded_at,
  -- Listing performance (one-to-one)
  lp.listing_price,
  lp.listing_gains_percent,
  lp.current_price,
  lp.current_gains_percent,
  -- Extended timeline dates from ipo_details (Story 4.12)
  d.basis_of_allotment_date,
  d.initiation_of_refunds_date,
  d.credit_of_shares_to_demat_date,
  d.ipo_listing_date as details_listing_date
FROM ipos i
LEFT JOIN financial_data f ON i.id = f.ipo_id
-- Get only the latest subscription snapshot per IPO
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (ipo_id)
    ipo_id,
    retail_times,
    nii_times,
    qib_times,
    total_times,
    recorded_at
  FROM subscriptions
  WHERE ipo_id = i.id
  ORDER BY ipo_id, recorded_at DESC
) s ON true
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
LEFT JOIN ipo_details d ON i.id = d.ipo_id
-- Only include IPOs with relevant dates for calendar display
WHERE i.open_date IS NOT NULL
   OR i.close_date IS NOT NULL
   OR i.listing_date IS NOT NULL
   OR d.basis_of_allotment_date IS NOT NULL
   OR d.initiation_of_refunds_date IS NOT NULL
   OR d.credit_of_shares_to_demat_date IS NOT NULL;

-- ==================== CREATE INDEXES ====================

-- Index on dates for calendar filtering (most common query pattern)
CREATE INDEX idx_calendar_view_dates
  ON calendar_view(open_date, close_date, listing_date);

-- Index on segment for category filtering (MAINBOARD vs SME)
CREATE INDEX idx_calendar_view_segment
  ON calendar_view(segment)
  WHERE segment IS NOT NULL;

-- Index on offering_type for filtering
CREATE INDEX idx_calendar_view_offering_type
  ON calendar_view(offering_type);

-- Index on status for filtering by IPO status
CREATE INDEX idx_calendar_view_status
  ON calendar_view(status);

-- Composite index for most common query: segment + status + dates
CREATE INDEX idx_calendar_view_segment_status_dates
  ON calendar_view(segment, status, open_date DESC, close_date DESC);

-- ==================== CREATE REFRESH FUNCTION ====================

-- Function to refresh the materialized view
-- This will be called by the scraper cron job after updating IPO data
CREATE OR REPLACE FUNCTION refresh_calendar_view()
RETURNS void AS $$
BEGIN
  -- CONCURRENTLY allows queries to continue during refresh
  -- Requires unique index, which we have via primary key id
  REFRESH MATERIALIZED VIEW CONCURRENTLY calendar_view;

  -- Log the refresh (optional, for monitoring)
  RAISE NOTICE 'Calendar materialized view refreshed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- ==================== GRANT PERMISSIONS ====================

-- Grant SELECT permissions on the view (adjust user as needed)
-- GRANT SELECT ON calendar_view TO ipodhan_readonly;

-- ==================== COMMENTS ====================

COMMENT ON MATERIALIZED VIEW calendar_view IS
  'Pre-joined calendar data for fast API response. Refreshed hourly by scraper cron job.';

COMMENT ON FUNCTION refresh_calendar_view() IS
  'Refreshes calendar_view materialized view. Called after scraper updates IPO data.';
