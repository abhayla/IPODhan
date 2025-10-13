-- Migration: Add historical IPO performance data fields
-- Story: 7.10 - Historical IPO Data Scraper Implementation
-- Date: 2025-10-13

-- Subscription data columns
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS subscription_retail DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS subscription_hni DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS subscription_qib DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS subscription_total DECIMAL(10,2);

-- GMP (Grey Market Premium) columns
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS gmp_price DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS gmp_percentage_historical DECIMAL(5,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS gmp_updated_at_historical TIMESTAMP;

-- Listing performance columns
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS listing_price_historical DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS listing_gain_percentage DECIMAL(5,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS listing_gain_amount DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS listing_date_historical DATE;

-- Current price tracking columns
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS current_price DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS current_gain_percentage DECIMAL(5,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS current_gain_amount DECIMAL(10,2);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS current_price_updated_at TIMESTAMP;

-- Metadata columns
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS historical_data_source VARCHAR(100);
ALTER TABLE ipos ADD COLUMN IF NOT EXISTS historical_data_scraped_at TIMESTAMP;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ipos_historical_data_scraped_at ON ipos(historical_data_scraped_at);
CREATE INDEX IF NOT EXISTS idx_ipos_subscription_total ON ipos(subscription_total) WHERE subscription_total IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ipos_listing_gain_percentage ON ipos(listing_gain_percentage) WHERE listing_gain_percentage IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN ipos.subscription_retail IS 'Retail investor subscription multiple (e.g., 5.2 means oversubscribed 5.2 times)';
COMMENT ON COLUMN ipos.subscription_hni IS 'High Net-Worth Individual subscription multiple';
COMMENT ON COLUMN ipos.subscription_qib IS 'Qualified Institutional Buyer subscription multiple';
COMMENT ON COLUMN ipos.subscription_total IS 'Overall subscription multiple (weighted average)';
COMMENT ON COLUMN ipos.gmp_price IS 'Grey Market Premium absolute value in rupees';
COMMENT ON COLUMN ipos.gmp_percentage_historical IS 'GMP as percentage of issue price';
COMMENT ON COLUMN ipos.listing_price_historical IS 'Price at which IPO listed on exchange';
COMMENT ON COLUMN ipos.listing_gain_percentage IS 'Percentage gain/loss on listing day from issue price';
COMMENT ON COLUMN ipos.listing_gain_amount IS 'Absolute gain/loss amount on listing day';
COMMENT ON COLUMN ipos.current_price IS 'Current market price (updated periodically)';
COMMENT ON COLUMN ipos.current_gain_percentage IS 'Current gain/loss percentage from issue price';
COMMENT ON COLUMN ipos.current_gain_amount IS 'Current absolute gain/loss from issue price';
COMMENT ON COLUMN ipos.historical_data_source IS 'Source of historical data (e.g., Chittorgarh)';
COMMENT ON COLUMN ipos.historical_data_scraped_at IS 'Timestamp when historical data was last scraped';
