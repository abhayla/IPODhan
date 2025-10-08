-- Migration: Add scraper_logs table for monitoring
-- Story: 7.5 Error Handling & Monitoring
-- Purpose: Track scraper execution logs with success/failure metrics

-- Create scraper_logs table
CREATE TABLE scraper_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                    -- 'NSE' | 'BSE' | 'API_FALLBACK'
  status TEXT NOT NULL,                     -- 'SUCCESS' | 'FAILURE' | 'PARTIAL'
  records_processed INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  duration_ms INTEGER NOT NULL,
  error_message TEXT,
  error_stack TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for efficient querying
CREATE INDEX idx_scraper_logs_created_at ON scraper_logs(created_at DESC);
CREATE INDEX idx_scraper_logs_source_created_at ON scraper_logs(source, created_at DESC);
CREATE INDEX idx_scraper_logs_status ON scraper_logs(status);

-- Add comments for documentation
COMMENT ON TABLE scraper_logs IS 'Tracks all scraper execution logs for monitoring and debugging';
COMMENT ON COLUMN scraper_logs.source IS 'Scraper source: NSE, BSE, or API_FALLBACK';
COMMENT ON COLUMN scraper_logs.status IS 'Execution status: SUCCESS, FAILURE, or PARTIAL';
COMMENT ON COLUMN scraper_logs.records_processed IS 'Number of IPO records successfully processed';
COMMENT ON COLUMN scraper_logs.records_failed IS 'Number of IPO records that failed processing';
COMMENT ON COLUMN scraper_logs.duration_ms IS 'Scraper execution duration in milliseconds';
COMMENT ON COLUMN scraper_logs.error_message IS 'Error message if execution failed';
COMMENT ON COLUMN scraper_logs.error_stack IS 'Full error stack trace for debugging';
